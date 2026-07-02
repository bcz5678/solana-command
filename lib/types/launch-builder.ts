// lib/types/launch-builder.ts
//
// DB-level types for the launch builder save/load layer.
// The graph payload re-uses the LaunchProfile shape from the builder component.
// NOTE: table names (launch_configs, launch_templates) must match your actual DB schema.

import type { LaunchProfile } from '@/components/tokens/launch-builder/launch-profile'
import type { LaunchTypeSubtype } from '@/components/tokens/launch-builder/types'

export type { LaunchProfile }

// Full row returned by the config endpoints
// Renamed from LaunchConfig to avoid collision with the LaunchConfig class in
// components/tokens/launch/launch-config-class.ts
export interface SavedLaunchConfig {
  id:            string
  user_id:       string
  token_mint_id: string | null
  name:          string
  description:   string | null
  launch_type:   LaunchTypeSubtype | null
  graph:         LaunchProfile
  settings:      Record<string, unknown>
  status:        'draft' | 'ready' | 'archived'
  version:       number
  created_at:    string
  updated_at:    string
}

// Full row returned by the template endpoints
export interface LaunchTemplate {
  id:          string
  user_id:     string
  name:        string
  description: string | null
  launch_type: LaunchTypeSubtype | null
  graph:       LaunchProfile
  settings:    Record<string, unknown>
  is_shared:   boolean
  use_count:   number
  created_at:  string
  updated_at:  string
}

// Lightweight rows returned by the list endpoints (selected columns only)
export interface SavedLaunchConfigSummary {
  id:          string
  name:        string
  description: string | null
  launch_type: LaunchTypeSubtype | null
  status:      'draft' | 'ready' | 'archived'
  updated_at:  string
}

export interface LaunchTemplateSummary {
  id:          string
  name:        string
  description: string | null
  launch_type: LaunchTypeSubtype | null
  use_count:   number
  is_shared:   boolean
  updated_at:  string
}
