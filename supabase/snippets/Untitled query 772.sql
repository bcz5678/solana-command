-- ============================================================
-- NODE-BASED LAUNCH BUILDER — CONFIGS + TEMPLATES
--
-- Two tables:
--   1. private.launch_configs   → working/saved node-graph configs
--                                  tied to a specific token (or draft)
--   2. private.launch_templates → reusable node-graph blueprints
--                                  not tied to any token, for cloning
--
-- Both store the builder graph as jsonb (nodes + edges + settings).
-- Follows the private-schema + public-view + security-definer pattern.
-- ============================================================


-- ===========================================================
-- TABLE: private.launch_configs
-- A concrete builder config, optionally attached to a token.
-- ===========================================================

CREATE TABLE IF NOT EXISTS private.launch_configs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Optional link to the token this config launches.
  -- NULL while the user is still building before picking a token.
  token_mint_id uuid        REFERENCES private.token_mints(id) ON DELETE SET NULL,

  -- Human-facing name for this config
  name          text        NOT NULL,
  description   text,

  -- The launch strategy this graph represents
  -- (matches your LaunchType enum: block0 | swarm | staggered | ...)
  launch_type   text        NOT NULL DEFAULT 'block0',

  -- The full node-graph payload from the visual builder:
  --   { nodes: [...], edges: [...], viewport: {...}, settings: {...} }
  -- Stored as jsonb so it's queryable/indexable if needed later.
  graph         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Free-form builder settings not part of the graph
  -- (e.g. global slippage, priority fee, jito tip defaults)
  settings      jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Lifecycle: draft (editing) | ready (validated) | archived
  status        text        NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'ready', 'archived')),

  -- Optimistic-concurrency version counter — bumped on every save.
  -- Lets the client detect stale overwrites.
  version       integer     NOT NULL DEFAULT 1,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_launch_configs_user
  ON private.launch_configs (user_id, status);

CREATE INDEX IF NOT EXISTS idx_launch_configs_token
  ON private.launch_configs (token_mint_id)
  WHERE token_mint_id IS NOT NULL;

-- GIN index on the graph for future queries into node structure
CREATE INDEX IF NOT EXISTS idx_launch_configs_graph
  ON private.launch_configs USING gin (graph);

ALTER TABLE private.launch_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.launch_configs FORCE ROW LEVEL SECURITY;

CREATE POLICY "launch_configs_no_direct_access"
  ON private.launch_configs FOR ALL USING (false);

DROP TRIGGER IF EXISTS launch_configs_updated_at ON private.launch_configs;
CREATE TRIGGER launch_configs_updated_at
  BEFORE UPDATE ON private.launch_configs
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


-- ===========================================================
-- TABLE: private.launch_templates
-- Reusable blueprints — clone into a new config to start fast.
-- Not tied to any token.
-- ===========================================================

CREATE TABLE IF NOT EXISTS private.launch_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  name          text        NOT NULL,
  description   text,

  launch_type   text        NOT NULL DEFAULT 'block0',

  -- Same graph shape as launch_configs.graph — this is the blueprint
  graph         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  settings      jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- Optional: allow a template to be shared with all users
  -- (super-admin-curated “official” templates). Personal by default.
  is_shared     boolean     NOT NULL DEFAULT false,

  -- Simple usage counter — how many configs were cloned from it
  use_count     integer     NOT NULL DEFAULT 0,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_launch_templates_user
  ON private.launch_templates (user_id);

-- Partial index for the shared-template lookup path
CREATE INDEX IF NOT EXISTS idx_launch_templates_shared
  ON private.launch_templates (is_shared)
  WHERE is_shared = true;

ALTER TABLE private.launch_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.launch_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY "launch_templates_no_direct_access"
  ON private.launch_templates FOR ALL USING (false);

DROP TRIGGER IF EXISTS launch_templates_updated_at ON private.launch_templates;
CREATE TRIGGER launch_templates_updated_at
  BEFORE UPDATE ON private.launch_templates
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();


-- ===========================================================
-- PUBLIC VIEWS
-- ===========================================================

-- Configs — invoker security so RLS/ownership scoping applies naturally
CREATE OR REPLACE VIEW public.launch_configs_view
WITH (security_invoker = true)
AS
  SELECT
    id, user_id, token_mint_id, name, description,
    launch_type, graph, settings, status, version,
    created_at, updated_at
  FROM private.launch_configs;

REVOKE ALL   ON public.launch_configs_view FROM PUBLIC;
REVOKE ALL   ON public.launch_configs_view FROM anon;
GRANT SELECT ON public.launch_configs_view TO authenticated;


CREATE OR REPLACE VIEW public.launch_templates_view
WITH (security_invoker = true)
AS
  SELECT
    id, user_id, name, description, launch_type,
    graph, settings, is_shared, use_count,
    created_at, updated_at
  FROM private.launch_templates;

REVOKE ALL   ON public.launch_templates_view FROM PUBLIC;
REVOKE ALL   ON public.launch_templates_view FROM anon;
GRANT SELECT ON public.launch_templates_view TO authenticated;


-- ===========================================================
-- CONFIG FUNCTIONS
-- ===========================================================

-- ── save_launch_config() ─────────────────────────────────────
-- Upsert: creates a new config when p_id is NULL, otherwise
-- updates the existing one (bumping the version counter).
CREATE OR REPLACE FUNCTION public.save_launch_config(
  p_id            uuid    DEFAULT NULL,
  p_name          text    DEFAULT NULL,
  p_description   text    DEFAULT NULL,
  p_launch_type   text    DEFAULT 'block0',
  p_graph         jsonb   DEFAULT '{}'::jsonb,
  p_settings      jsonb   DEFAULT '{}'::jsonb,
  p_token_mint_id uuid    DEFAULT NULL,
  p_status        text    DEFAULT NULL,
  p_expected_version integer DEFAULT NULL   -- optimistic concurrency guard
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_id      uuid;
  v_version integer;
  v_owner   uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- ── CREATE path ────────────────────────────────────────────
  IF p_id IS NULL THEN
    IF p_name IS NULL THEN
      RAISE EXCEPTION 'name is required when creating a config';
    END IF;

    INSERT INTO private.launch_configs (
      user_id, token_mint_id, name, description,
      launch_type, graph, settings, status
    )
    VALUES (
      auth.uid(), p_token_mint_id, p_name, p_description,
      p_launch_type, p_graph, p_settings,
      COALESCE(p_status, 'draft')
    )
    RETURNING id, version INTO v_id, v_version;

  -- ── UPDATE path ────────────────────────────────────────────
  ELSE
    -- Lock + ownership check
    SELECT user_id, version INTO v_owner, v_version
    FROM   private.launch_configs
    WHERE  id = p_id
    FOR UPDATE;

    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'Launch config % not found', p_id;
    END IF;

    IF v_owner != auth.uid() AND NOT (SELECT public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized: config not owned by caller';
    END IF;

    -- Optimistic concurrency — reject stale overwrites
    IF p_expected_version IS NOT NULL AND p_expected_version != v_version THEN
      RAISE EXCEPTION 'Version conflict: expected %, current is % — reload before saving',
        p_expected_version, v_version;
    END IF;

    UPDATE private.launch_configs
    SET
      name          = COALESCE(p_name,          name),
      description   = CASE WHEN p_description  IS NULL THEN description ELSE NULLIF(p_description, '') END,
      launch_type   = COALESCE(p_launch_type,   launch_type),
      -- graph/settings replace wholesale when provided (non-empty)
      graph         = CASE WHEN p_graph    = '{}'::jsonb THEN graph    ELSE p_graph    END,
      settings      = CASE WHEN p_settings = '{}'::jsonb THEN settings ELSE p_settings END,
      token_mint_id = COALESCE(p_token_mint_id, token_mint_id),
      status        = COALESCE(p_status,        status),
      version       = version + 1
    WHERE id = p_id
    RETURNING id, version INTO v_id, v_version;
  END IF;

  RETURN jsonb_build_object(
    'id',      v_id,
    'version', v_version
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.save_launch_config(uuid,text,text,text,jsonb,jsonb,uuid,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_launch_config(uuid,text,text,text,jsonb,jsonb,uuid,text,integer) TO authenticated;


-- ── get_launch_configs() ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_launch_configs(
  p_token_mint_id uuid DEFAULT NULL   -- optional filter to one token
)
RETURNS TABLE (
  id            uuid,
  user_id       uuid,
  token_mint_id uuid,
  name          text,
  description   text,
  launch_type   text,
  graph         jsonb,
  settings      jsonb,
  status        text,
  version       integer,
  created_at    timestamptz,
  updated_at    timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
    SELECT
      lc.id, lc.user_id, lc.token_mint_id, lc.name, lc.description,
      lc.launch_type, lc.graph, lc.settings, lc.status, lc.version,
      lc.created_at, lc.updated_at
    FROM private.launch_configs lc
    WHERE lc.user_id = auth.uid()
      AND (p_token_mint_id IS NULL OR lc.token_mint_id = p_token_mint_id)
    ORDER BY lc.updated_at DESC;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_launch_configs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_launch_configs(uuid) TO authenticated;


-- ── get_launch_config() — single by id ───────────────────────
CREATE OR REPLACE FUNCTION public.get_launch_config(
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
DECLARE
  v_row  private.launch_configs%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_row
  FROM   private.launch_configs
  WHERE  id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Launch config % not found', p_id;
  END IF;

  IF v_row.user_id != auth.uid() AND NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: config not owned by caller';
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL    ON FUNCTION public.get_launch_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_launch_config(uuid) TO authenticated;


-- ── delete_launch_config() ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_launch_config(
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT user_id INTO v_owner
  FROM   private.launch_configs
  WHERE  id = p_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Launch config % not found', p_id;
  END IF;

  IF v_owner != auth.uid() AND NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: config not owned by caller';
  END IF;

  DELETE FROM private.launch_configs WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END;
$$;

REVOKE ALL    ON FUNCTION public.delete_launch_config(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_launch_config(uuid) TO authenticated;


-- ===========================================================
-- TEMPLATE FUNCTIONS
-- ===========================================================

-- ── save_launch_template() — create or update ────────────────
CREATE OR REPLACE FUNCTION public.save_launch_template(
  p_id          uuid    DEFAULT NULL,
  p_name        text    DEFAULT NULL,
  p_description text    DEFAULT NULL,
  p_launch_type text    DEFAULT 'block0',
  p_graph       jsonb   DEFAULT '{}'::jsonb,
  p_settings    jsonb   DEFAULT '{}'::jsonb,
  p_is_shared   boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_id    uuid;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Only super admins may mark a template as shared (official)
  IF p_is_shared IS TRUE AND NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Only super admins can create shared templates';
  END IF;

  IF p_id IS NULL THEN
    IF p_name IS NULL THEN
      RAISE EXCEPTION 'name is required when creating a template';
    END IF;

    INSERT INTO private.launch_templates (
      user_id, name, description, launch_type,
      graph, settings, is_shared
    )
    VALUES (
      auth.uid(), p_name, p_description, p_launch_type,
      p_graph, p_settings, COALESCE(p_is_shared, false)
    )
    RETURNING id INTO v_id;

  ELSE
    SELECT user_id INTO v_owner
    FROM   private.launch_templates
    WHERE  id = p_id
    FOR UPDATE;

    IF v_owner IS NULL THEN
      RAISE EXCEPTION 'Template % not found', p_id;
    END IF;

    IF v_owner != auth.uid() AND NOT (SELECT public.is_super_admin()) THEN
      RAISE EXCEPTION 'Unauthorized: template not owned by caller';
    END IF;

    UPDATE private.launch_templates
    SET
      name        = COALESCE(p_name,        name),
      description = CASE WHEN p_description IS NULL THEN description ELSE NULLIF(p_description, '') END,
      launch_type = COALESCE(p_launch_type, launch_type),
      graph       = CASE WHEN p_graph    = '{}'::jsonb THEN graph    ELSE p_graph    END,
      settings    = CASE WHEN p_settings = '{}'::jsonb THEN settings ELSE p_settings END,
      is_shared   = COALESCE(p_is_shared,   is_shared)
    WHERE id = p_id
    RETURNING id INTO v_id;
  END IF;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

REVOKE ALL    ON FUNCTION public.save_launch_template(uuid,text,text,text,jsonb,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_launch_template(uuid,text,text,text,jsonb,jsonb,boolean) TO authenticated;


-- ── get_launch_templates() — own + shared ────────────────────
CREATE OR REPLACE FUNCTION public.get_launch_templates()
RETURNS TABLE (
  id          uuid,
  user_id     uuid,
  name        text,
  description text,
  launch_type text,
  graph       jsonb,
  settings    jsonb,
  is_shared   boolean,
  use_count   integer,
  created_at  timestamptz,
  updated_at  timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = private, public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
    SELECT
      lt.id, lt.user_id, lt.name, lt.description, lt.launch_type,
      lt.graph, lt.settings, lt.is_shared, lt.use_count,
      lt.created_at, lt.updated_at
    FROM private.launch_templates lt
    -- Caller sees their own templates plus any shared/official ones
    WHERE lt.user_id = auth.uid()
       OR lt.is_shared = true
    ORDER BY lt.is_shared DESC, lt.updated_at DESC;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_launch_templates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_launch_templates() TO authenticated;


-- ── clone_template_to_config() ───────────────────────────────
-- Instantiates a new working config from a template's graph,
-- and bumps the template's use_count.
CREATE OR REPLACE FUNCTION public.clone_template_to_config(
  p_template_id uuid,
  p_name        text    DEFAULT NULL,   -- optional override name
  p_token_mint_id uuid  DEFAULT NULL    -- optional token to attach
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_tpl     private.launch_templates%ROWTYPE;
  v_new_id  uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Fetch template — must be own or shared
  SELECT * INTO v_tpl
  FROM   private.launch_templates
  WHERE  id = p_template_id
    AND  (user_id = auth.uid() OR is_shared = true);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template % not found or not accessible', p_template_id;
  END IF;

  -- Create a fresh config from the template graph
  INSERT INTO private.launch_configs (
    user_id, token_mint_id, name, description,
    launch_type, graph, settings, status
  )
  VALUES (
    auth.uid(),
    p_token_mint_id,
    COALESCE(p_name, v_tpl.name || ' (copy)'),
    v_tpl.description,
    v_tpl.launch_type,
    v_tpl.graph,
    v_tpl.settings,
    'draft'
  )
  RETURNING id INTO v_new_id;

  -- Bump the template usage counter
  UPDATE private.launch_templates
  SET    use_count = use_count + 1
  WHERE  id = p_template_id;

  RETURN jsonb_build_object(
    'config_id',   v_new_id,
    'template_id', p_template_id
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.clone_template_to_config(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_template_to_config(uuid,text,uuid) TO authenticated;


-- ── delete_launch_template() ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_launch_template(
  p_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = private, public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT user_id INTO v_owner
  FROM   private.launch_templates
  WHERE  id = p_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Template % not found', p_id;
  END IF;

  IF v_owner != auth.uid() AND NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION 'Unauthorized: template not owned by caller';
  END IF;

  DELETE FROM private.launch_templates WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'deleted', true);
END;
$$;

REVOKE ALL    ON FUNCTION public.delete_launch_template(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_launch_template(uuid) TO authenticated;


-- ===========================================================
-- VERIFICATION
-- ===========================================================
SELECT table_name, column_name, data_type
FROM   information_schema.columns
WHERE  table_schema = 'private'
  AND  table_name  IN ('launch_configs', 'launch_templates')
ORDER BY table_name, ordinal_position;