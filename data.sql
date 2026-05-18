SET session_replication_role = replica;

--
-- PostgreSQL database dump
--

-- \restrict r1GkMv50EQnvtYnVLMM4950Ywpqd0caCtrIouFewPmdZ4jXauEsXV6dLbUe4ktb

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: audit_log_entries; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."audit_log_entries" ("instance_id", "id", "payload", "created_at", "ip_address") FROM stdin;
00000000-0000-0000-0000-000000000000	e68b079f-f56c-4a6e-8037-afcc74083d93	{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"brian@abundancedigitalmedia.com","user_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","user_phone":""}}	2026-05-02 20:44:56.54818+00	
00000000-0000-0000-0000-000000000000	e4c0b4be-ab9c-4a44-8d47-8d170ae7cf8e	{"action":"user_signedup","actor_id":"00000000-0000-0000-0000-000000000000","actor_username":"service_role","actor_via_sso":false,"log_type":"team","traits":{"provider":"email","user_email":"chad@mtgsf.com","user_id":"0ab308fd-305b-4748-b9df-53c77a7485d0","user_phone":""}}	2026-05-02 20:45:24.546641+00	
00000000-0000-0000-0000-000000000000	a906519b-a5e0-4fe0-b3df-68d599a18724	{"action":"login","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}	2026-05-03 12:55:32.53258+00	
00000000-0000-0000-0000-000000000000	f3f603dc-e801-4ade-989c-f709454d0c9e	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-03 14:21:41.664005+00	
00000000-0000-0000-0000-000000000000	59ca4a4c-f55b-4b82-9483-7103ebf6c767	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-03 14:21:41.667535+00	
00000000-0000-0000-0000-000000000000	aa035c33-6b9f-411a-bdbb-9384f7464a8d	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-03 14:21:46.958099+00	
00000000-0000-0000-0000-000000000000	cd6206bb-ffa3-4299-a40a-7ac5aaca877c	{"action":"logout","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"account"}	2026-05-03 14:21:47.077279+00	
00000000-0000-0000-0000-000000000000	9f4de434-194f-4cec-b91a-632f4a1c5150	{"action":"login","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"account","traits":{"provider":"email"}}	2026-05-03 14:22:00.887472+00	
00000000-0000-0000-0000-000000000000	82f493d1-4572-4d0f-ac8e-0dfb6de749cd	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-04 12:35:12.470351+00	
00000000-0000-0000-0000-000000000000	8161a942-cc54-4279-b5a4-89c6cac29f84	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-04 12:35:12.47312+00	
00000000-0000-0000-0000-000000000000	77bbe18d-b044-4b54-b900-cfb855c1aa90	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-05 13:28:31.485272+00	
00000000-0000-0000-0000-000000000000	0ea0ef13-105e-4f9e-a29c-684bc2394a8e	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-05 13:29:18.214474+00	
00000000-0000-0000-0000-000000000000	b0aae231-5518-4cae-84a7-c11e070c3e5f	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 12:33:54.187764+00	
00000000-0000-0000-0000-000000000000	370ea906-8de4-40e1-a8d9-e3099ea489e3	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 12:33:54.190089+00	
00000000-0000-0000-0000-000000000000	2035fffa-2ca6-4d54-a732-4867ec37c23e	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 13:32:21.756836+00	
00000000-0000-0000-0000-000000000000	5af7df41-f326-4f2b-a089-bf703efb5a5d	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 13:32:21.759147+00	
00000000-0000-0000-0000-000000000000	ff055d5f-7074-433f-8871-152fa7024049	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 14:37:12.682257+00	
00000000-0000-0000-0000-000000000000	8782c88a-b7b3-4520-a2ec-22e2caa31635	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 14:37:12.685527+00	
00000000-0000-0000-0000-000000000000	d3505ff2-027e-4240-8f95-6af83b763920	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 15:35:20.735293+00	
00000000-0000-0000-0000-000000000000	203cf5a2-a605-4a0f-ab7b-ae7147465658	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 15:35:20.739289+00	
00000000-0000-0000-0000-000000000000	93c55b54-07d5-40ef-aa4a-32df2bc59c81	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 16:35:09.414965+00	
00000000-0000-0000-0000-000000000000	bad8f080-919e-4cb6-bc97-e90fccce4e5b	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 16:35:09.421349+00	
00000000-0000-0000-0000-000000000000	0550bef2-0638-486a-b46b-c3efcf1f0f06	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 16:35:09.722887+00	
00000000-0000-0000-0000-000000000000	32587232-7b98-4619-8a41-dc7e9aff3f04	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 16:40:10.893345+00	
00000000-0000-0000-0000-000000000000	839bfd28-cbfe-4165-b793-f37571985bcf	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 18:40:20.878182+00	
00000000-0000-0000-0000-000000000000	bf4faf3e-9b82-4e8e-9a8f-3bdf86ca9654	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 18:40:20.883845+00	
00000000-0000-0000-0000-000000000000	022dd755-ef7f-4b0c-9b86-b81b37b587ae	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 18:44:18.473698+00	
00000000-0000-0000-0000-000000000000	dd7b8ad3-1547-490a-a4b1-fdc1fbd08a8f	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 21:00:40.854805+00	
00000000-0000-0000-0000-000000000000	95b7f592-b510-4535-9c3d-8f7beb0a053c	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 21:00:40.856031+00	
00000000-0000-0000-0000-000000000000	e030a78d-84d6-494c-a4c6-2ed53e76d448	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 21:00:47.278022+00	
00000000-0000-0000-0000-000000000000	c3d872a4-b216-4c46-8f95-010966f99669	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 21:59:16.894632+00	
00000000-0000-0000-0000-000000000000	2ad6fcca-9f7b-48c4-825e-c610296cd9c9	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-06 21:59:16.896677+00	
00000000-0000-0000-0000-000000000000	57f55575-7ada-490c-a51e-2d4b3bbd43d4	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-07 00:00:16.235478+00	
00000000-0000-0000-0000-000000000000	acf0bd08-8838-403b-aac3-39666429ffec	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-07 00:00:16.239878+00	
00000000-0000-0000-0000-000000000000	55068074-b429-4531-aad1-5864f941cc31	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-07 00:00:22.354197+00	
00000000-0000-0000-0000-000000000000	7c51b7c2-8174-42fe-a7c8-46a5c52ee3af	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-07 00:00:38.63624+00	
00000000-0000-0000-0000-000000000000	630d6887-894d-4ebe-b6a6-95e82557e144	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-07 13:15:57.68085+00	
00000000-0000-0000-0000-000000000000	108dfc56-6181-4e60-a3ea-c2a5a9f5cab3	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-07 13:15:57.696931+00	
00000000-0000-0000-0000-000000000000	4c28bd23-1794-4803-bdf8-d84813399b54	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-07 13:18:09.525495+00	
00000000-0000-0000-0000-000000000000	3de76410-3835-4c1a-b2a4-501761c64adc	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-07 13:18:24.887946+00	
00000000-0000-0000-0000-000000000000	f8aa7282-e66e-43d8-ac7b-45fc97784815	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 01:33:05.311148+00	
00000000-0000-0000-0000-000000000000	801894e6-6209-400b-ba58-affefd13feb0	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 01:33:05.315128+00	
00000000-0000-0000-0000-000000000000	3f086307-9049-4ff4-b5c3-22a9afd5b52b	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 01:33:10.680366+00	
00000000-0000-0000-0000-000000000000	0bd0fc89-3d83-4ad8-a13b-81cbacb8987a	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 15:32:07.118184+00	
00000000-0000-0000-0000-000000000000	229a4d00-8c15-4fc7-b649-514b432078f2	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 15:32:07.124431+00	
00000000-0000-0000-0000-000000000000	881ecefe-b08f-42d0-a879-e18eb327de39	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 15:32:15.19774+00	
00000000-0000-0000-0000-000000000000	2e3e072b-0800-4fe4-bee2-eee26cad7d81	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 15:32:25.002455+00	
00000000-0000-0000-0000-000000000000	986f6dda-bdab-4a1e-8864-c4ae1c412176	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 15:32:50.176312+00	
00000000-0000-0000-0000-000000000000	1b171fdb-9940-4a2a-ad73-976a77fd34f1	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 18:53:16.810823+00	
00000000-0000-0000-0000-000000000000	34b409d0-54f7-4947-a3c8-47399c46c61d	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 18:53:16.814583+00	
00000000-0000-0000-0000-000000000000	c8fcc1de-c78b-4d70-9a1a-59c14fc37673	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 19:11:35.006771+00	
00000000-0000-0000-0000-000000000000	32022685-d0ce-4624-b0fc-ca918c81a8b9	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 19:11:41.209168+00	
00000000-0000-0000-0000-000000000000	2725f88d-a2b3-43c8-983c-4e2d957b9029	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 19:11:44.745718+00	
00000000-0000-0000-0000-000000000000	46d262a0-acaa-434a-99c6-5e997ebc41da	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 19:11:52.066439+00	
00000000-0000-0000-0000-000000000000	9b37b4b2-03e0-42d2-a9ea-55f26ffbe261	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 22:18:09.766496+00	
00000000-0000-0000-0000-000000000000	43d30d2f-7241-434a-81c1-9d9b10b76d0a	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-08 22:18:09.774699+00	
00000000-0000-0000-0000-000000000000	9a544024-990c-49c3-89a5-a78c9bd5a5a1	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 00:27:14.3531+00	
00000000-0000-0000-0000-000000000000	0d3acc67-ceaf-4d6a-8c5e-f680f5eaa010	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 00:27:14.355555+00	
00000000-0000-0000-0000-000000000000	30d3bbce-f06f-4df8-a3e8-60db0e8f511e	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 13:49:34.469942+00	
00000000-0000-0000-0000-000000000000	c3cc6b42-8e13-452b-b700-b5e60a7b32ff	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 13:49:34.476237+00	
00000000-0000-0000-0000-000000000000	7da75ecc-9d37-4deb-988f-c194122ea7ba	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 13:49:38.501046+00	
00000000-0000-0000-0000-000000000000	57032a46-5cdb-477b-b6db-e3ff1580f752	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 14:50:59.310777+00	
00000000-0000-0000-0000-000000000000	822c3c9c-8f6d-4057-ba57-e58d7569b7c9	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 14:50:59.313061+00	
00000000-0000-0000-0000-000000000000	5c712791-3795-498d-8ca4-d22cc0b43203	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 14:51:03.353714+00	
00000000-0000-0000-0000-000000000000	f3d86fbe-85e4-4721-a606-102cfa471527	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 14:57:14.941451+00	
00000000-0000-0000-0000-000000000000	26e0db69-20f4-4e38-a638-2ffccf694104	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 15:35:17.842315+00	
00000000-0000-0000-0000-000000000000	de93661a-1624-4996-a68e-ab79640dfb26	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 15:36:31.278329+00	
00000000-0000-0000-0000-000000000000	0282f70e-21a6-464c-ba2f-be162fc19769	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 16:03:46.711351+00	
00000000-0000-0000-0000-000000000000	9fc8b632-e634-47fa-88af-2719eb9bcbe2	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 16:06:42.966379+00	
00000000-0000-0000-0000-000000000000	a10c9573-fa3f-4539-9211-1c70a6306367	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 16:42:27.562272+00	
00000000-0000-0000-0000-000000000000	8e0ed90d-7ded-454d-895b-d9581920537c	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 16:43:51.592826+00	
00000000-0000-0000-0000-000000000000	74c75806-c1bb-49ce-aedb-099426122c50	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 18:41:29.504598+00	
00000000-0000-0000-0000-000000000000	aa314bdf-bb81-4e77-bc91-3e00296bd6ca	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 18:41:29.508126+00	
00000000-0000-0000-0000-000000000000	2a8e30fa-aaac-4ed0-adef-d02a09a7fc37	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 18:41:35.729991+00	
00000000-0000-0000-0000-000000000000	3e9199a6-0fee-4f35-8b20-19ef9ed575e0	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 20:25:27.810235+00	
00000000-0000-0000-0000-000000000000	6102a929-36d1-4d26-8e98-22e30e8714cc	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 20:25:27.812628+00	
00000000-0000-0000-0000-000000000000	7ae0acea-de81-44ba-8554-e31dfea9ef2d	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 21:38:03.87927+00	
00000000-0000-0000-0000-000000000000	aa8eab37-0d76-455f-8053-902a142c5309	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 21:38:03.881199+00	
00000000-0000-0000-0000-000000000000	c1bc726a-72d8-4867-a0b3-2593b43aa233	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 22:36:25.889231+00	
00000000-0000-0000-0000-000000000000	31c8602d-a688-4be9-b2a3-67852d7dfb62	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 22:36:25.890433+00	
00000000-0000-0000-0000-000000000000	6e49e695-1377-4c39-839d-1f261fa99ec1	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 23:34:33.065027+00	
00000000-0000-0000-0000-000000000000	6bd6c9d9-fd21-4409-ba3e-10aad4353069	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-09 23:34:33.068682+00	
00000000-0000-0000-0000-000000000000	2fee7b19-bbd9-4598-8b39-8323e5e0a472	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 00:34:01.761715+00	
00000000-0000-0000-0000-000000000000	f3f469f4-7fbe-4426-bd27-c78c851ab475	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 00:34:01.764033+00	
00000000-0000-0000-0000-000000000000	7a83899d-9485-4036-83c8-06c2f1071aa7	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 01:51:28.993691+00	
00000000-0000-0000-0000-000000000000	a86d95ff-9c02-4e6f-ba4e-4b7ca0ef7fd4	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 01:51:28.995347+00	
00000000-0000-0000-0000-000000000000	8189fa9f-87c7-44cf-a575-f0a3c7e426c7	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 02:52:45.680068+00	
00000000-0000-0000-0000-000000000000	fb597423-0134-421c-8979-717b03bcf29f	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 02:52:45.68214+00	
00000000-0000-0000-0000-000000000000	69b24df4-59a1-4a91-9879-c9716bf3ccbc	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 09:12:01.480446+00	
00000000-0000-0000-0000-000000000000	e7dd254f-7b25-472c-9f8e-42ff74cda526	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 09:12:01.481851+00	
00000000-0000-0000-0000-000000000000	96955e0c-4853-49ca-a7eb-f109f50862cc	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 15:46:52.561358+00	
00000000-0000-0000-0000-000000000000	17d6a11c-8928-4a04-9ef8-b1846be2157e	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 15:46:52.564431+00	
00000000-0000-0000-0000-000000000000	b5025b9d-4ccb-4150-aef5-84ee05563828	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 15:48:24.325682+00	
00000000-0000-0000-0000-000000000000	651acb3e-2385-4713-a7c5-5e2d3e1437a4	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 16:58:42.86699+00	
00000000-0000-0000-0000-000000000000	9d6fea0e-560a-44ff-8da1-844964dd7e32	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 16:58:42.86904+00	
00000000-0000-0000-0000-000000000000	dd5c4251-37f1-4c10-9678-b3f3b581dc02	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-10 16:58:55.409621+00	
00000000-0000-0000-0000-000000000000	b920e28c-43d2-4302-87e2-454906084838	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-11 12:45:10.178493+00	
00000000-0000-0000-0000-000000000000	777c562a-6d02-4635-975d-eaee6ea24077	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-11 12:45:10.181967+00	
00000000-0000-0000-0000-000000000000	57e1936e-1e61-48e9-9046-58cf85111f0c	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-11 12:45:14.629109+00	
00000000-0000-0000-0000-000000000000	f890df2a-36c8-46e3-8dea-2ec623d70691	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-11 12:45:19.329203+00	
00000000-0000-0000-0000-000000000000	c1a18fd8-dd3a-4870-bccb-e5a565aebf98	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-11 13:53:55.136962+00	
00000000-0000-0000-0000-000000000000	2d65b5a1-2bf4-4bcb-b41a-5e05d9ec4cae	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-11 13:53:55.139079+00	
00000000-0000-0000-0000-000000000000	273cca5f-25ce-4ac3-8eb2-8e264594a845	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-11 15:20:45.587332+00	
00000000-0000-0000-0000-000000000000	cc857af7-682d-4f1d-86c7-e20588bc25be	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-11 15:20:45.590054+00	
00000000-0000-0000-0000-000000000000	5583a705-c823-43d8-82f4-17d53ede8ea4	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-12 00:04:35.269084+00	
00000000-0000-0000-0000-000000000000	a159f7f1-a7f8-43ee-8cbe-99951d6f38d2	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-12 00:17:51.614264+00	
00000000-0000-0000-0000-000000000000	c6131efc-7ef1-49f9-852c-e0a7c0f232a6	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 02:56:09.433247+00	
00000000-0000-0000-0000-000000000000	e670fd92-da59-45e1-aeda-a1023018967b	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 02:56:09.436773+00	
00000000-0000-0000-0000-000000000000	82a6f705-98ed-4bf7-848c-224be2e8c832	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 02:56:14.597608+00	
00000000-0000-0000-0000-000000000000	c7b78284-500a-4af1-82fa-f49be452cda4	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 04:19:50.066847+00	
00000000-0000-0000-0000-000000000000	5eeac3db-d6e9-409f-b485-4c88430a85ae	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 04:19:50.070389+00	
00000000-0000-0000-0000-000000000000	8e6172d1-8a42-4e24-b413-69c68e2a636b	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 12:26:05.091708+00	
00000000-0000-0000-0000-000000000000	1ef79e79-3564-4b54-bd3f-b49e84b28020	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 12:26:05.095846+00	
00000000-0000-0000-0000-000000000000	963a8e0b-3b7d-4541-95ec-4b296ca27e1d	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 13:24:11.430525+00	
00000000-0000-0000-0000-000000000000	f5d1a7d5-b4e1-47b6-8285-7e63f2163915	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 13:24:11.433213+00	
00000000-0000-0000-0000-000000000000	60740f90-037a-4fb6-8960-d025daca2de1	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 14:22:19.863262+00	
00000000-0000-0000-0000-000000000000	fe469075-f986-4901-ad0b-c88545a441a6	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 14:22:19.865323+00	
00000000-0000-0000-0000-000000000000	09c4ccc9-0fff-4489-834b-9d571c66e169	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 15:29:24.084607+00	
00000000-0000-0000-0000-000000000000	b21ca623-640a-4d0d-92f6-5d18e7fa3a76	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 15:29:24.089204+00	
00000000-0000-0000-0000-000000000000	3b535ad8-2ba4-4e4a-a772-38e0bb91173c	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 17:16:19.580004+00	
00000000-0000-0000-0000-000000000000	d6dcd88e-cc63-4f04-9980-1fe72a2e3c65	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 17:16:19.582764+00	
00000000-0000-0000-0000-000000000000	7c065335-b01b-4c8b-ab65-93f8beffde75	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 17:16:28.773996+00	
00000000-0000-0000-0000-000000000000	ceb5fc57-8e54-4a34-afc2-343502ec8a3c	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 18:57:57.978613+00	
00000000-0000-0000-0000-000000000000	c57c92cc-c342-49a9-acea-4a6b2f085e3c	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 18:57:57.981359+00	
00000000-0000-0000-0000-000000000000	f8ba76ab-ce37-4879-8e63-d8ecb0aa060a	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 20:35:09.409951+00	
00000000-0000-0000-0000-000000000000	8fb5a960-2b47-4c0a-94a8-ee784155fa9e	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 20:35:09.412199+00	
00000000-0000-0000-0000-000000000000	ee58daf6-904b-4560-a114-05e34b52abd0	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 20:35:15.629825+00	
00000000-0000-0000-0000-000000000000	0acbdefc-5a67-4423-b809-28c98ec2348b	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 21:33:19.864518+00	
00000000-0000-0000-0000-000000000000	de4cea25-e2cb-4d72-8812-9e374272ac12	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 21:33:19.867665+00	
00000000-0000-0000-0000-000000000000	188cc116-cf14-42f0-8f8a-7025f1e5e6dc	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 22:44:13.62674+00	
00000000-0000-0000-0000-000000000000	a5746509-125e-4832-ae7f-1a6c8ae3bedc	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 22:44:13.628559+00	
00000000-0000-0000-0000-000000000000	6d4944c0-b4a9-47e2-be84-5b3a9c170566	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 23:42:32.304211+00	
00000000-0000-0000-0000-000000000000	d46188b5-b052-4c3d-ad4f-e61d402d7612	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-13 23:42:32.30753+00	
00000000-0000-0000-0000-000000000000	9a8aa7a2-2e33-4658-b979-9d57c6003da0	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 00:40:42.019701+00	
00000000-0000-0000-0000-000000000000	b7e968cd-575f-4848-9e35-5720dd2a96b8	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 00:40:42.022111+00	
00000000-0000-0000-0000-000000000000	4f3cd60b-fe01-4442-b73b-17d31a1fa296	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 01:38:46.775114+00	
00000000-0000-0000-0000-000000000000	9ed9aed9-03c0-4a95-a25b-cb511d860f21	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 01:38:46.77733+00	
00000000-0000-0000-0000-000000000000	52470f76-f2b6-453b-aa37-01986bfc7a9d	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 02:36:47.250669+00	
00000000-0000-0000-0000-000000000000	b8e60c7e-8aa5-4de4-b6e6-d82e1e1b4f6b	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 02:36:47.252887+00	
00000000-0000-0000-0000-000000000000	d187ad9e-2049-4c19-a194-160f5deb99c7	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 03:35:16.796333+00	
00000000-0000-0000-0000-000000000000	ab5a913d-4d99-443f-ab36-2b53048f1e30	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 03:35:16.799532+00	
00000000-0000-0000-0000-000000000000	28f336fd-a1ac-4349-a91b-0d0e1f166065	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 12:27:57.346234+00	
00000000-0000-0000-0000-000000000000	711ef26d-5996-4bad-8ab4-92808ae79121	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 12:27:57.348232+00	
00000000-0000-0000-0000-000000000000	fc3d1e55-7cf0-4e9e-ba58-2b47576aa1f2	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 12:28:01.160108+00	
00000000-0000-0000-0000-000000000000	2fe16fee-7813-4950-84e7-a302fec6a577	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 17:03:39.8852+00	
00000000-0000-0000-0000-000000000000	d56e0df1-043e-4c42-aac8-1e4cb68a91be	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 17:03:39.889441+00	
00000000-0000-0000-0000-000000000000	b315be3a-e201-48eb-bc1c-880df35a2ae5	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 17:03:58.795177+00	
00000000-0000-0000-0000-000000000000	c991f8af-bc19-4fa0-9ae9-3ae15eda87b8	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 17:13:26.728775+00	
00000000-0000-0000-0000-000000000000	2dd527fc-ea64-467c-90e5-5824fa7f235a	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 17:13:49.178003+00	
00000000-0000-0000-0000-000000000000	00af80ac-d5fb-4ce1-a842-f66c16c7a8de	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 17:14:10.297208+00	
00000000-0000-0000-0000-000000000000	23b262de-23c2-40c4-847e-2f8def07d0af	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 20:53:24.189506+00	
00000000-0000-0000-0000-000000000000	68f4b4dd-fb28-48de-bd1c-27dc4d3ac8af	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 20:53:24.192841+00	
00000000-0000-0000-0000-000000000000	074937fb-7aa2-4dfd-95c2-a5cf0f972625	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-14 20:53:28.115645+00	
00000000-0000-0000-0000-000000000000	ac72e8ac-5635-460e-b6fc-7dda925d2aa7	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 17:05:46.107342+00	
00000000-0000-0000-0000-000000000000	83f6f348-3177-43f3-accf-e8db5424acde	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 17:05:46.112435+00	
00000000-0000-0000-0000-000000000000	16a49e65-948c-4a53-9b3c-9058c5337f6c	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 17:06:08.667649+00	
00000000-0000-0000-0000-000000000000	55d89ec1-7c5a-41ae-827a-a35321c5594e	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 17:07:25.704561+00	
00000000-0000-0000-0000-000000000000	c12b8358-d4dc-418f-8798-906ea9329016	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 19:28:31.078778+00	
00000000-0000-0000-0000-000000000000	4e833b87-582b-4d65-8720-3bfd75efefae	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 19:28:31.083795+00	
00000000-0000-0000-0000-000000000000	6a92ad4c-8f2a-498d-b099-aa61a2409a71	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 20:26:44.480116+00	
00000000-0000-0000-0000-000000000000	70bc01bd-f963-45af-996c-ad1c92c6da88	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 20:26:44.482834+00	
00000000-0000-0000-0000-000000000000	9de777f8-c489-496f-9579-63ba79d040b7	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 22:09:08.353286+00	
00000000-0000-0000-0000-000000000000	bf390ba4-27a7-4a8f-aea4-71ca75379d0c	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 22:09:08.355364+00	
00000000-0000-0000-0000-000000000000	12d768bc-a2a6-453d-aca5-574eeb798c82	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 22:09:11.960368+00	
00000000-0000-0000-0000-000000000000	f09d02d8-ee9f-4867-86a1-2a6cf3a96530	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 23:07:40.275601+00	
00000000-0000-0000-0000-000000000000	1da351b5-2774-429c-9c3a-c9f474c39ed3	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-15 23:07:40.277512+00	
00000000-0000-0000-0000-000000000000	28da09fb-82fc-420b-ae5b-37d2d2caf62b	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 00:41:24.74115+00	
00000000-0000-0000-0000-000000000000	6d935fb5-db68-469d-bef7-01f5c8a9f955	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 00:41:24.743028+00	
00000000-0000-0000-0000-000000000000	89427501-1268-49e4-9640-907a58bd8dde	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 00:41:30.324965+00	
00000000-0000-0000-0000-000000000000	9355635f-f069-41fd-b33e-f5d590fbb5c1	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 21:17:05.929564+00	
00000000-0000-0000-0000-000000000000	69d16119-27af-440e-839f-0142928be317	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 21:17:05.931627+00	
00000000-0000-0000-0000-000000000000	a60e8245-b56d-47c3-b258-bd4741d791d0	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 21:17:08.449539+00	
00000000-0000-0000-0000-000000000000	4a190b85-209f-4034-bb24-52caaebff8c9	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 21:17:12.365794+00	
00000000-0000-0000-0000-000000000000	675cc9a5-8c36-41c6-bdf0-dc43485f3e9d	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 22:17:32.568609+00	
00000000-0000-0000-0000-000000000000	35147239-ee53-44b9-a929-a35dc6fa5e20	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 22:17:32.571343+00	
00000000-0000-0000-0000-000000000000	dbe47393-08d6-434c-b4b6-e459431ecd69	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 22:58:57.46942+00	
00000000-0000-0000-0000-000000000000	a925033f-f030-4793-af50-80558a591b09	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 22:58:59.917662+00	
00000000-0000-0000-0000-000000000000	1d352c1e-230d-4d6d-8c68-94cf0779e1d6	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-16 22:59:02.981679+00	
00000000-0000-0000-0000-000000000000	f865a4df-2e24-4e24-a31d-111fe3d99154	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 13:38:52.364775+00	
00000000-0000-0000-0000-000000000000	c1eee2fb-4023-4a85-a790-3402aa39a714	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 13:38:52.366905+00	
00000000-0000-0000-0000-000000000000	7e086a0b-569e-499a-885a-61ddcde574e4	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 13:46:00.519798+00	
00000000-0000-0000-0000-000000000000	b5553c8a-e1f2-4894-9945-7b2d40414dcd	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 14:45:24.198444+00	
00000000-0000-0000-0000-000000000000	63aedf7b-0498-4a14-acc3-ebd6f8fb2f08	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 14:45:24.203068+00	
00000000-0000-0000-0000-000000000000	64561ab9-1d9b-46bf-9a53-8f5c3ae20181	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 15:43:39.425976+00	
00000000-0000-0000-0000-000000000000	9a07dcc1-cd59-4f77-b770-2d93f7c28a70	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 15:43:39.428316+00	
00000000-0000-0000-0000-000000000000	88ce5085-a9b7-4648-947e-4a933d250b5f	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 17:11:35.858668+00	
00000000-0000-0000-0000-000000000000	7046c45c-2688-4863-8f1f-e88e77aaad0b	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 17:11:35.861393+00	
00000000-0000-0000-0000-000000000000	bfb31ea3-8c79-44be-9bcd-8444ee74daf7	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 17:11:40.107347+00	
00000000-0000-0000-0000-000000000000	b0ac8f29-fc0a-450f-98d9-9493a74d2a91	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 18:10:01.914617+00	
00000000-0000-0000-0000-000000000000	3ea9f265-461a-478e-b982-0ca07e868fd5	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 18:10:01.916732+00	
00000000-0000-0000-0000-000000000000	2c59a827-2063-42df-8e22-7ef209f3b214	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 19:08:01.893568+00	
00000000-0000-0000-0000-000000000000	17222066-cbe6-41b4-8869-1bb5bf6871c9	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 19:08:01.894896+00	
00000000-0000-0000-0000-000000000000	c297d6dc-1ed5-4b6f-8880-7d79003143bb	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 20:09:32.74716+00	
00000000-0000-0000-0000-000000000000	918ba420-61a7-407c-a8b6-4a77f6e5be10	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 20:09:32.750328+00	
00000000-0000-0000-0000-000000000000	0fa15605-594a-4afb-a4c9-8fa1665d0a17	{"action":"token_refreshed","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 21:07:56.742445+00	
00000000-0000-0000-0000-000000000000	b20c7a10-b9bf-4595-8b64-7ad3cd252002	{"action":"token_revoked","actor_id":"86db7fd5-e7ea-4361-9249-bf3f349de2ee","actor_username":"brian@abundancedigitalmedia.com","actor_via_sso":false,"log_type":"token"}	2026-05-17 21:07:56.744651+00	
\.


--
-- Data for Name: custom_oauth_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."custom_oauth_providers" ("id", "provider_type", "identifier", "name", "client_id", "client_secret", "acceptable_client_ids", "scopes", "pkce_enabled", "attribute_mapping", "authorization_params", "enabled", "email_optional", "issuer", "discovery_url", "skip_nonce_check", "cached_discovery", "discovery_cached_at", "authorization_url", "token_url", "userinfo_url", "jwks_uri", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: flow_state; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."flow_state" ("id", "user_id", "auth_code", "code_challenge_method", "code_challenge", "provider_type", "provider_access_token", "provider_refresh_token", "created_at", "updated_at", "authentication_method", "auth_code_issued_at", "invite_token", "referrer", "oauth_client_state_id", "linking_target_id", "email_optional") FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."users" ("instance_id", "id", "aud", "role", "email", "encrypted_password", "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at", "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change", "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data", "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at", "phone_change", "phone_change_token", "phone_change_sent_at", "email_change_token_current", "email_change_confirm_status", "banned_until", "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous") FROM stdin;
00000000-0000-0000-0000-000000000000	0ab308fd-305b-4748-b9df-53c77a7485d0	authenticated	authenticated	chad@mtgsf.com	$2a$10$dxCAayUiXnPDflPa9Nn1uO4LqfADyMQ/R9NtnpqRjroqyvkSzjyg.	2026-05-02 20:45:24.550762+00	\N		\N		\N			\N	\N	{"provider": "email", "providers": ["email"]}	{"email_verified": true}	\N	2026-05-02 20:45:24.53698+00	2026-05-02 20:45:24.55346+00	\N	\N			\N		0	\N		\N	f	\N	f
00000000-0000-0000-0000-000000000000	86db7fd5-e7ea-4361-9249-bf3f349de2ee	authenticated	authenticated	brian@abundancedigitalmedia.com	$2a$10$YARaQgqTOIqVBNq1yuQwh./Hr78adDV0u0f7u5mLWfvC2L8p0E2ye	2026-05-02 20:44:56.554227+00	\N		\N		\N			\N	2026-05-03 14:22:00.888757+00	{"provider": "email", "providers": ["email"]}	{"email_verified": true}	\N	2026-05-02 20:44:56.529123+00	2026-05-17 21:07:56.750497+00	\N	\N			\N		0	\N		\N	f	\N	f
\.


--
-- Data for Name: identities; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."identities" ("provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at", "id") FROM stdin;
86db7fd5-e7ea-4361-9249-bf3f349de2ee	86db7fd5-e7ea-4361-9249-bf3f349de2ee	{"sub": "86db7fd5-e7ea-4361-9249-bf3f349de2ee", "email": "brian@abundancedigitalmedia.com", "email_verified": false, "phone_verified": false}	email	2026-05-02 20:44:56.540789+00	2026-05-02 20:44:56.540862+00	2026-05-02 20:44:56.540862+00	204d9e5d-b50a-4d0f-9f13-2163b14d4c16
0ab308fd-305b-4748-b9df-53c77a7485d0	0ab308fd-305b-4748-b9df-53c77a7485d0	{"sub": "0ab308fd-305b-4748-b9df-53c77a7485d0", "email": "chad@mtgsf.com", "email_verified": false, "phone_verified": false}	email	2026-05-02 20:45:24.541605+00	2026-05-02 20:45:24.541668+00	2026-05-02 20:45:24.541668+00	2af801ea-3860-49fb-b677-1a7b83d7b862
\.


--
-- Data for Name: instances; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."instances" ("id", "uuid", "raw_base_config", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: oauth_clients; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."oauth_clients" ("id", "client_secret_hash", "registration_type", "redirect_uris", "grant_types", "client_name", "client_uri", "logo_uri", "created_at", "updated_at", "deleted_at", "client_type", "token_endpoint_auth_method") FROM stdin;
\.


--
-- Data for Name: sessions; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."sessions" ("id", "user_id", "created_at", "updated_at", "factor_id", "aal", "not_after", "refreshed_at", "user_agent", "ip", "tag", "oauth_client_id", "refresh_token_hmac_key", "refresh_token_counter", "scopes") FROM stdin;
054d66fc-b95c-4b21-9e84-09d73b5591ba	86db7fd5-e7ea-4361-9249-bf3f349de2ee	2026-05-03 14:22:00.888836+00	2026-05-17 21:07:56.754723+00	\N	aal1	\N	2026-05-17 21:07:56.75465	Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36	172.20.0.1	\N	\N	\N	\N	\N
\.


--
-- Data for Name: mfa_amr_claims; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."mfa_amr_claims" ("session_id", "created_at", "updated_at", "authentication_method", "id") FROM stdin;
054d66fc-b95c-4b21-9e84-09d73b5591ba	2026-05-03 14:22:00.89969+00	2026-05-03 14:22:00.89969+00	password	da345ca8-cea3-4782-956c-07fd0e77463a
\.


--
-- Data for Name: mfa_factors; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."mfa_factors" ("id", "user_id", "friendly_name", "factor_type", "status", "created_at", "updated_at", "secret", "phone", "last_challenged_at", "web_authn_credential", "web_authn_aaguid", "last_webauthn_challenge_data") FROM stdin;
\.


--
-- Data for Name: mfa_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."mfa_challenges" ("id", "factor_id", "created_at", "verified_at", "ip_address", "otp_code", "web_authn_session_data") FROM stdin;
\.


--
-- Data for Name: oauth_authorizations; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."oauth_authorizations" ("id", "authorization_id", "client_id", "user_id", "redirect_uri", "scope", "state", "resource", "code_challenge", "code_challenge_method", "response_type", "status", "authorization_code", "created_at", "expires_at", "approved_at", "nonce") FROM stdin;
\.


--
-- Data for Name: oauth_client_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."oauth_client_states" ("id", "provider_type", "code_verifier", "created_at") FROM stdin;
\.


--
-- Data for Name: oauth_consents; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."oauth_consents" ("id", "user_id", "client_id", "scopes", "granted_at", "revoked_at") FROM stdin;
\.


--
-- Data for Name: one_time_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."one_time_tokens" ("id", "user_id", "token_type", "token_hash", "relates_to", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: refresh_tokens; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."refresh_tokens" ("instance_id", "id", "token", "user_id", "revoked", "created_at", "updated_at", "parent", "session_id") FROM stdin;
00000000-0000-0000-0000-000000000000	3	tinrplmyvubw	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-03 14:22:00.894486+00	2026-05-04 12:35:12.47423+00	\N	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	4	bylxjhuqlcax	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-04 12:35:12.477149+00	2026-05-06 12:33:54.190946+00	tinrplmyvubw	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	5	qd6earwyngtt	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-06 12:33:54.192872+00	2026-05-06 13:32:21.760022+00	bylxjhuqlcax	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	6	enyjwtez26li	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-06 13:32:21.761566+00	2026-05-06 14:37:12.688033+00	qd6earwyngtt	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	7	4jlgaz4bx2gx	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-06 14:37:12.740473+00	2026-05-06 15:35:20.740712+00	enyjwtez26li	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	8	rucsm6xiing7	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-06 15:35:20.742982+00	2026-05-06 16:35:09.438383+00	4jlgaz4bx2gx	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	9	fi7s7zfocapp	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-06 16:35:09.44545+00	2026-05-06 18:40:20.885862+00	rucsm6xiing7	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	10	ttas6ceyvtqg	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-06 18:40:20.888634+00	2026-05-06 21:00:40.85699+00	fi7s7zfocapp	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	11	edizp7r3zmxr	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-06 21:00:40.858191+00	2026-05-06 21:59:16.897772+00	ttas6ceyvtqg	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	12	alq63g3ovdcg	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-06 21:59:16.899369+00	2026-05-07 00:00:16.241251+00	edizp7r3zmxr	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	13	2ewgn6hyeucu	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-07 00:00:16.244262+00	2026-05-07 13:15:57.699189+00	alq63g3ovdcg	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	14	o3gtihrin6ls	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-07 13:15:57.707118+00	2026-05-08 01:33:05.316219+00	2ewgn6hyeucu	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	15	mocgemtrwqg5	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-08 01:33:05.318918+00	2026-05-08 15:32:07.125345+00	o3gtihrin6ls	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	16	wse5kgwl6vmi	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-08 15:32:07.130989+00	2026-05-08 18:53:16.815805+00	mocgemtrwqg5	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	17	7llz6re6iamo	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-08 18:53:16.819305+00	2026-05-08 22:18:09.778084+00	wse5kgwl6vmi	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	18	bofeylj7ab2t	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-08 22:18:09.781601+00	2026-05-09 00:27:14.356458+00	7llz6re6iamo	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	19	tdxlztml6etx	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-09 00:27:14.358394+00	2026-05-09 13:49:34.477339+00	bofeylj7ab2t	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	20	f2dqawvjpsoh	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-09 13:49:34.483086+00	2026-05-09 14:50:59.314044+00	tdxlztml6etx	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	21	6edzoubhp6cb	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-09 14:50:59.315959+00	2026-05-09 18:41:29.509189+00	f2dqawvjpsoh	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	22	etmhoiiwjsqe	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-09 18:41:29.512203+00	2026-05-09 20:25:27.813229+00	6edzoubhp6cb	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	23	m3zb4dblfpzh	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-09 20:25:27.815353+00	2026-05-09 21:38:03.881887+00	etmhoiiwjsqe	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	24	htlolilv2hq3	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-09 21:38:03.882583+00	2026-05-09 22:36:25.891389+00	m3zb4dblfpzh	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	25	2vzwppva5pz6	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-09 22:36:25.892671+00	2026-05-09 23:34:33.071715+00	htlolilv2hq3	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	26	qbzyfc7jos5h	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-09 23:34:33.077464+00	2026-05-10 00:34:01.765089+00	2vzwppva5pz6	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	27	hrsdfb46pxa4	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-10 00:34:01.766517+00	2026-05-10 01:51:28.996316+00	qbzyfc7jos5h	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	28	koqaovlrwdge	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-10 01:51:28.998435+00	2026-05-10 02:52:45.682902+00	hrsdfb46pxa4	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	29	73mjrunwwkfv	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-10 02:52:45.684624+00	2026-05-10 09:12:01.482934+00	koqaovlrwdge	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	30	z3cy6j224llt	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-10 09:12:01.484404+00	2026-05-10 15:46:52.565208+00	73mjrunwwkfv	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	31	thrdkmijw4bg	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-10 15:46:52.566156+00	2026-05-10 16:58:42.869802+00	z3cy6j224llt	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	32	nqk5ezvz6pc3	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-10 16:58:42.871324+00	2026-05-11 12:45:10.182726+00	thrdkmijw4bg	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	33	elfvpirr5522	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-11 12:45:10.183674+00	2026-05-11 13:53:55.139887+00	nqk5ezvz6pc3	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	34	m6qrcn2ztbse	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-11 13:53:55.141698+00	2026-05-11 15:20:45.590757+00	elfvpirr5522	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	35	vt5d5zbxnhln	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-11 15:20:45.591581+00	2026-05-13 02:56:09.437963+00	m6qrcn2ztbse	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	36	ne7kzzxv5w2g	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 02:56:09.439154+00	2026-05-13 04:19:50.071479+00	vt5d5zbxnhln	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	37	rhzbk66i2hvq	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 04:19:50.073884+00	2026-05-13 12:26:05.097275+00	ne7kzzxv5w2g	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	38	doxd456j4vqn	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 12:26:05.100542+00	2026-05-13 13:24:11.434152+00	rhzbk66i2hvq	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	39	hiwffr3zxsqi	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 13:24:11.436159+00	2026-05-13 14:22:19.86615+00	doxd456j4vqn	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	40	3fqcnhdwnjwq	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 14:22:19.867796+00	2026-05-13 15:29:24.09113+00	hiwffr3zxsqi	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	41	xiwu2r7hgarg	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 15:29:24.093915+00	2026-05-13 17:16:19.583614+00	3fqcnhdwnjwq	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	42	ny7edk2stdov	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 17:16:19.586067+00	2026-05-13 18:57:57.982057+00	xiwu2r7hgarg	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	43	z4hbouqwunyz	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 18:57:57.984582+00	2026-05-13 20:35:09.413168+00	ny7edk2stdov	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	44	wxik47zaqc4r	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 20:35:09.414955+00	2026-05-13 21:33:19.8684+00	z4hbouqwunyz	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	45	uapxdnqioqws	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 21:33:19.87004+00	2026-05-13 22:44:13.629327+00	wxik47zaqc4r	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	46	isvliv74as4g	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 22:44:13.630535+00	2026-05-13 23:42:32.308766+00	uapxdnqioqws	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	47	72zb6dyzjk2w	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-13 23:42:32.310997+00	2026-05-14 00:40:42.023025+00	isvliv74as4g	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	48	pw37nzxcwqzc	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-14 00:40:42.024969+00	2026-05-14 01:38:46.778107+00	72zb6dyzjk2w	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	49	arrxis3pof2v	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-14 01:38:46.779894+00	2026-05-14 02:36:47.25389+00	pw37nzxcwqzc	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	50	or74ouegm3q3	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-14 02:36:47.255917+00	2026-05-14 03:35:16.800389+00	arrxis3pof2v	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	51	dqc2x37btr2e	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-14 03:35:16.802217+00	2026-05-14 12:27:57.349103+00	or74ouegm3q3	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	52	k7qerfntg5cd	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-14 12:27:57.351135+00	2026-05-14 17:03:39.890772+00	dqc2x37btr2e	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	62	ybkmbaqjc5wq	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-16 22:17:32.575715+00	2026-05-17 13:38:52.367563+00	ocaanllmlree	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	53	ojqdm2wmebsi	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-14 17:03:39.893475+00	2026-05-14 20:53:24.19374+00	k7qerfntg5cd	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	63	mvfqe2jr7tnx	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-17 13:38:52.369344+00	2026-05-17 14:45:24.205501+00	ybkmbaqjc5wq	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	54	7z5wunhqlnw2	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-14 20:53:24.1958+00	2026-05-15 17:05:46.113684+00	ojqdm2wmebsi	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	55	qw3m7y4rzxop	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-15 17:05:46.119749+00	2026-05-15 19:28:31.085897+00	7z5wunhqlnw2	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	64	g4fqqlqi3okq	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-17 14:45:24.209667+00	2026-05-17 15:43:39.429232+00	mvfqe2jr7tnx	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	56	6o7wu2m7txmx	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-15 19:28:31.089865+00	2026-05-15 20:26:44.483755+00	qw3m7y4rzxop	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	65	qigdyum7fw7p	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-17 15:43:39.43244+00	2026-05-17 17:11:35.862311+00	g4fqqlqi3okq	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	57	ghscthwffvyh	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-15 20:26:44.485523+00	2026-05-15 22:09:08.356247+00	6o7wu2m7txmx	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	58	3ejjpywowbc6	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-15 22:09:08.357953+00	2026-05-15 23:07:40.278455+00	ghscthwffvyh	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	66	skgs6p3cv5ky	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-17 17:11:35.865497+00	2026-05-17 18:10:01.917502+00	qigdyum7fw7p	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	59	cggfq4qx7lj6	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-15 23:07:40.280122+00	2026-05-16 00:41:24.74378+00	3ejjpywowbc6	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	67	blsguqpw4qbs	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-17 18:10:01.919218+00	2026-05-17 19:08:01.89612+00	skgs6p3cv5ky	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	60	coh3djsbwgvg	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-16 00:41:24.746579+00	2026-05-16 21:17:05.932422+00	cggfq4qx7lj6	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	61	ocaanllmlree	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-16 21:17:05.934173+00	2026-05-16 22:17:32.573368+00	coh3djsbwgvg	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	68	njigs2zh473b	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-17 19:08:01.897082+00	2026-05-17 20:09:32.751167+00	blsguqpw4qbs	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	69	co7s5wzgl7jh	86db7fd5-e7ea-4361-9249-bf3f349de2ee	t	2026-05-17 20:09:32.753268+00	2026-05-17 21:07:56.745368+00	njigs2zh473b	054d66fc-b95c-4b21-9e84-09d73b5591ba
00000000-0000-0000-0000-000000000000	70	yemjqcwzm5ny	86db7fd5-e7ea-4361-9249-bf3f349de2ee	f	2026-05-17 21:07:56.748193+00	2026-05-17 21:07:56.748193+00	co7s5wzgl7jh	054d66fc-b95c-4b21-9e84-09d73b5591ba
\.


--
-- Data for Name: sso_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."sso_providers" ("id", "resource_id", "created_at", "updated_at", "disabled") FROM stdin;
\.


--
-- Data for Name: saml_providers; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."saml_providers" ("id", "sso_provider_id", "entity_id", "metadata_xml", "metadata_url", "attribute_mapping", "created_at", "updated_at", "name_id_format") FROM stdin;
\.


--
-- Data for Name: saml_relay_states; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."saml_relay_states" ("id", "sso_provider_id", "request_id", "for_email", "redirect_to", "created_at", "updated_at", "flow_state_id") FROM stdin;
\.


--
-- Data for Name: sso_domains; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."sso_domains" ("id", "sso_provider_id", "domain", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: webauthn_challenges; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."webauthn_challenges" ("id", "user_id", "challenge_type", "session_data", "created_at", "expires_at") FROM stdin;
\.


--
-- Data for Name: webauthn_credentials; Type: TABLE DATA; Schema: auth; Owner: supabase_auth_admin
--

COPY "auth"."webauthn_credentials" ("id", "user_id", "credential_id", "public_key", "attestation_type", "aaguid", "sign_count", "transports", "backup_eligible", "backed_up", "friendly_name", "created_at", "updated_at", "last_used_at") FROM stdin;
\.


--
-- Data for Name: owners; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."owners" ("id", "created_at", "name") FROM stdin;
1	2026-05-04 12:37:33.600699+00	Brian
2	2026-05-04 12:37:42.708478+00	Chad
3	2026-05-04 12:37:52.0968+00	DRS
\.


--
-- Data for Name: profiles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."profiles" ("id", "created_at", "name", "img_url") FROM stdin;
\.


--
-- Data for Name: wallet_groups; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."wallet_groups" ("id", "created_at", "name", "owner_id") FROM stdin;
2	2026-05-06 13:24:50.749825+00	brian_dev_1	1
3	2026-05-06 14:38:18.804673+00	new_test_group	1
7	2026-05-06 17:18:04.074908+00	chad_volume_1	2
1	2026-05-04 12:41:42.665098+00	DRS_dev_1	3
4	2026-05-06 15:14:09.451846+00	DRS_trading_1	1
9	2026-05-07 00:14:16.027982+00	DRS_funding_1	3
\.


--
-- Data for Name: wallet_type; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."wallet_type" ("id", "created_at", "name") FROM stdin;
1	2026-05-04 12:40:15.183262+00	Dev
2	2026-05-04 12:40:23.18863+00	Holder
3	2026-05-04 12:40:35.606324+00	Volume
4	2026-05-04 12:40:43.310696+00	Test
5	2026-05-04 12:40:53.475149+00	Trader
6	2026-05-06 14:03:41.652948+00	Funding
\.


--
-- Data for Name: wallets; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."wallets" ("id", "created_at", "public_key", "secret_key", "funded", "wallet_type_id", "solana_balance_in_lamports", "owner_id", "group_id", "token_holdings", "profile_id") FROM stdin;
6	2026-05-07 00:31:06.129697+00	2Cuq6Z48KWn9pgr1CsAcCL5GeZsJokLq8CXuTEdsjcLK	190,126,174,252,19,29,0,255,52,194,71,178,207,139,30,52,30,186,177,228,65,45,78,191,240,80,126,133,78,81,203,185,17,232,207,94,110,215,215,141,162,57,32,218,116,62,246,41,182,120,11,170,225,182,88,183,144,110,68,219,24,29,56,188	f	5	0	3	4	[]	\N
7	2026-05-09 22:35:52.236095+00	DrQDWKc8PzuvRu2uTJW2jurLUZEtk4eYWeXz9wcCLSp4	4jGAMXNcdTtFUJXCpFSb4di2EEPuTYLn17GnHMP6WdQHCu3mPhytH1hKghLvJxTcZobifkKrSJPSVHUJRcwEiiMr	f	1	0	3	1	[]	\N
8	2026-05-11 12:45:34.800693+00	DAQp4iotCHy45UpLH3ZpcMKKVuzag7z6U9Hhvtm2WHpF	SQ78BrNUhV875PVFsWctoQpsh1w4y637esjKSmWJ9RPEbhKmRmpTCderhioj5gno2y8QBL2ZfwdC5u7xK1oRHwq	f	5	0	3	4	[]	\N
1	2026-05-06 21:01:33.118933+00	48KbntsmvMUgrkHGUoan18yVyGvjCsrN8sPm2HtY5DN1	44,158,99,175,176,181,139,13,52,103,199,44,9,67,237,161,212,152,91,168,171,242,180,81,147,107,241,90,146,19,217,253,46,115,40,72,185,131,79,111,185,235,46,247,157,76,56,155,17,59,54,32,113,122,4,172,32,97,0,89,147,182,117,98	t	6	0	3	9	[]	\N
9	2026-05-14 17:19:26.694175+00	BGdeceSdUZ8WSZqrToQzDNvtihcQYG1UMDqnTGoxc8J3	47Nht6ucaP3gp5MBAyA5pwxBezhSKoVvyuqokmygCvN2SwgyZ2diGijcpNvLjykHTEZ4QQB1yK5RFJCNosfC7VsV	f	5	0	3	4	[]	\N
\.


--
-- Data for Name: tokens; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."tokens" ("id", "created_at", "name", "symbol", "description", "dev_wallet_id", "contract_address", "website_url", "twitter_url", "telegram_handle", "logo_url", "launched", "mint_secret_key", "token_meta_url", "owner_id") FROM stdin;
1	2026-05-10 17:03:55.727507+00	Insane in the Don Brain	DONBRAIN	Who you trying to get crazy with ése?\nDon't you know I'm loco?	7	7xtcEjHYk5ARCawT3UUubE9TXyAs46Vr7uC9Guhxpump				public/DONBRAIN_7xtcEjH_logo.png	f	[171,7,137,134,158,122,108,145,195,244,112,41,222,158,233,54,100,168,64,215,59,18,23,45,68,41,177,68,255,106,226,9,103,119,107,59,130,218,212,47,132,137,223,94,71,179,210,255,17,128,156,181,182,28,119,86,151,86,140,18,246,26,202,191]	{}	3
\.


--
-- Data for Name: transactions; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."transactions" ("id", "created_at", "transaction_time", "wallet_id", "transaction_signature", "transaction_actions", "fee_in_lamports", "priority_fee_in_lamports", "token_pair") FROM stdin;
\.


--
-- Data for Name: vanity_keypairs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY "public"."vanity_keypairs" ("id", "created_at", "mint_secret_key", "available", "contract_address") FROM stdin;
7	2026-05-10 16:19:36.529148+00	[58,242,234,212,46,12,28,235,161,64,249,114,28,5,161,110,211,163,154,35,204,189,156,65,31,63,39,78,9,101,91,83,112,120,201,7,119,23,134,178,186,228,40,191,119,12,48,102,41,148,77,190,68,90,129,87,3,197,29,42,231,119,132,175]	t	8a3V9PyZSkoJrs1t8bWGNEfGepFHLjK77meL4gLmpump
8	2026-05-10 16:19:36.537773+00	[239,50,29,191,157,217,83,40,139,243,122,254,231,138,36,113,254,199,47,190,168,175,163,203,170,196,220,177,12,122,221,228,118,95,126,226,215,248,32,21,245,88,122,165,5,208,149,31,84,248,236,219,28,84,104,4,56,113,131,219,64,219,13,31]	t	8y5ZnEoDCSUuZWqzC6ivxj9R3HZntt1YHnmuPY8tpump
9	2026-05-10 16:19:36.54674+00	[149,4,207,25,233,217,55,211,130,32,20,11,157,190,4,233,56,104,167,215,208,69,28,219,92,38,242,198,174,190,80,213,130,20,6,106,3,179,175,214,226,34,89,90,234,53,26,177,138,9,14,230,155,51,190,72,54,190,185,17,20,66,191,63]	t	9kmiEhdiRL2LwEVrLLSJvpLytr6nBNr3KW9ctJrrpump
10	2026-05-10 16:19:36.554923+00	[199,178,37,171,150,101,231,174,178,122,236,187,140,235,193,157,210,99,248,221,189,239,97,110,31,50,110,101,143,64,24,32,15,252,222,181,56,151,15,212,175,8,247,105,156,106,33,101,191,132,247,197,59,87,106,105,92,112,220,211,15,14,19,143]	t	25QknbnAgcCbvqDqZr8xvUkKSpU2QHCNcPtGsjWspump
11	2026-05-10 16:19:36.56507+00	[64,192,45,143,85,117,208,141,237,246,169,48,22,41,97,50,66,199,84,12,151,16,48,230,254,202,146,2,121,216,120,192,75,44,92,210,30,200,123,160,162,250,3,87,235,220,17,180,13,246,221,253,75,254,147,220,181,64,138,89,159,61,172,79]	t	64Sp5yZZijJw55bYd7awMQv9K8NEb517BvoFGZwdpump
12	2026-05-10 16:19:36.574309+00	[240,47,68,131,246,218,195,118,171,36,255,251,36,93,221,169,120,193,105,81,86,98,49,62,203,32,157,144,70,251,65,62,147,4,56,107,14,89,226,205,50,18,53,135,223,21,161,88,174,15,186,222,186,13,115,79,100,44,7,246,24,20,83,143]	t	AttfX2nQV13B4yKRYgtHygyGHx5sojedfHkoPgjVpump
13	2026-05-10 16:19:36.583221+00	[245,209,43,12,5,5,134,141,146,49,149,17,88,120,65,220,9,252,201,25,243,249,168,130,82,106,34,24,92,245,67,42,198,131,88,70,13,119,187,201,246,53,75,177,190,151,209,231,8,122,145,113,179,112,167,35,55,38,16,102,214,103,55,47]	t	EMutQ7S83efCcdpJXAeJa557EkjGitYufxzMd9gqpump
14	2026-05-10 16:19:36.592507+00	[6,170,113,210,127,188,249,212,61,135,255,237,37,248,177,154,19,162,44,7,55,28,1,180,186,221,88,241,228,122,21,18,219,99,177,74,198,76,198,125,207,71,143,149,116,211,54,58,120,62,4,189,69,72,85,197,179,226,85,102,165,218,146,127]	t	FmQTMceQ3yYARLwAGh2VHz9RgsZpyU6fbRgRJgY2pump
15	2026-05-10 16:19:36.601483+00	[254,226,191,41,215,217,131,57,54,161,129,108,170,67,183,133,108,148,188,2,166,242,143,61,10,122,253,132,91,57,203,16,239,229,112,21,165,67,17,48,213,156,227,170,142,220,28,222,104,80,205,161,55,244,12,65,208,163,36,58,0,29,1,79]	t	H9TMdj9Zo13vJVXEeS7aPHu81rQNrYASBkZFhdoDpump
16	2026-05-10 16:19:36.610207+00	[137,145,36,202,165,211,28,131,107,135,103,127,243,76,28,222,65,89,71,209,129,133,55,19,46,246,229,90,25,37,215,195,241,188,93,62,45,98,20,23,116,49,162,176,130,146,62,150,189,17,122,105,223,11,135,103,180,42,221,93,78,226,18,239]	t	HGdr34ZUxK4E2AUo4GruWGF46cjnNwXjowUHeydspump
17	2026-05-10 16:37:52.026254+00	[52,163,154,127,34,238,199,5,53,117,98,242,225,99,63,190,216,228,252,1,145,152,74,109,165,216,110,32,109,150,221,195,78,88,37,193,205,99,216,234,78,212,105,70,40,42,174,3,118,115,112,18,112,236,145,11,166,125,198,23,224,112,113,31]	t	6Gpkzdbm3KAos97S4EkGTf76mjdcBr1NtwnGoJdApump
18	2026-05-10 16:37:52.039716+00	[150,46,156,145,193,198,50,50,212,155,147,61,95,169,121,13,135,29,4,4,54,168,47,51,199,122,90,81,189,113,63,26,210,201,240,156,134,78,0,206,245,181,105,139,206,124,92,250,144,67,227,101,7,65,46,116,69,245,153,21,242,124,178,111]	t	FBqDNB6RfNX1AR6cXxcSw8h3MSeKyZhywxgV8hZ3pump
19	2026-05-10 16:37:52.050106+00	[237,148,92,216,0,142,213,39,113,240,172,230,183,237,86,17,42,224,4,246,86,181,163,0,66,34,166,190,144,191,146,134,218,124,101,207,89,250,207,227,92,173,142,3,150,217,81,202,118,230,230,65,131,144,94,160,92,15,92,118,112,62,172,207]	t	FhstyMsq9dqHJPDqWrKA7BbdduKMKnc65SwmEb1Hpump
20	2026-05-10 16:37:52.059645+00	[50,58,73,131,191,98,150,61,206,156,252,131,132,47,123,198,76,180,131,132,168,120,244,176,45,90,166,38,205,178,202,80,233,200,94,100,83,138,187,216,144,136,80,23,150,196,181,178,116,58,226,242,191,166,56,254,82,108,45,195,239,248,95,15]	t	GjbCe7m6yPu8wvmqiETMbGsRXF4yZtwajq21h27dpump
21	2026-05-10 16:37:52.069384+00	[184,83,145,247,178,53,134,192,32,121,61,16,206,232,199,163,190,236,191,133,112,248,107,61,244,222,206,47,59,214,6,241,199,101,177,184,176,252,222,22,184,55,78,42,242,157,246,150,161,51,198,34,24,237,132,153,47,15,54,88,13,112,121,63]	t	ERN56ydZtcxM7gP3rwjdBs4cS8eH1638fMwQi7wCpump
22	2026-05-10 16:37:52.079096+00	[135,150,154,228,54,202,95,76,54,95,178,139,132,102,4,58,63,161,88,145,41,80,240,180,186,48,45,158,229,21,68,34,231,197,120,97,98,112,69,46,24,50,227,174,65,220,161,49,254,50,195,30,239,207,190,168,148,46,119,255,72,113,49,207]	t	Gbjpfjs6mxqURv1uH3waiYhMDrYhCuQeoV1X9tjZpump
23	2026-05-10 16:37:52.087821+00	[78,65,124,19,147,24,9,39,66,4,206,62,242,120,219,147,42,7,249,86,111,126,77,194,174,174,255,117,226,153,1,51,126,241,242,56,158,165,182,102,161,94,204,6,102,212,164,250,89,147,43,122,9,104,144,207,204,19,178,223,67,231,106,223]	t	9YYMCpssJvqwYi5UhNo5c9CwtLM5tCYCS4Mndhyrpump
24	2026-05-10 16:37:52.096669+00	[164,181,255,218,209,98,73,172,132,76,32,253,230,234,20,39,127,84,27,81,143,165,26,142,31,148,234,160,144,232,215,18,112,133,83,46,212,40,207,100,65,121,117,165,99,188,175,109,212,187,29,39,126,52,64,80,148,211,220,116,238,152,102,143]	t	8aEaNdhB5ah89iVFUMaMMaoaJVP594GkrSrnWz4Kpump
6	2026-05-10 16:19:36.51754+00	[171,7,137,134,158,122,108,145,195,244,112,41,222,158,233,54,100,168,64,215,59,18,23,45,68,41,177,68,255,106,226,9,103,119,107,59,130,218,212,47,132,137,223,94,71,179,210,255,17,128,156,181,182,28,119,86,151,86,140,18,246,26,202,191]	f	7xtcEjHYk5ARCawT3UUubE9TXyAs46Vr7uC9Guhxpump
25	2026-05-10 16:37:52.105849+00	[174,75,196,203,177,230,92,247,72,134,119,219,252,90,195,46,215,247,91,220,129,240,36,174,245,15,208,110,235,36,211,167,254,237,252,60,47,122,165,189,140,121,103,113,190,184,136,101,86,129,91,206,19,223,72,23,109,73,53,25,232,33,51,127]	t	JA92n3XJmPKLDNpozmSciFnppmHAzWERHyZUiH8npump
26	2026-05-10 16:37:52.115872+00	[194,148,45,50,202,44,154,16,177,25,92,226,127,255,183,252,57,188,154,77,186,105,59,172,1,183,206,62,212,21,20,188,138,121,38,114,21,67,135,230,14,130,107,189,62,15,1,63,58,241,172,43,237,76,102,198,47,194,31,84,139,135,125,95]	t	AKYQfvfpsvGpMARA65hCDmvrMKDYDCC7fTpUcatYpump
27	2026-05-11 12:48:27.503433+00	[96,178,222,119,125,218,82,75,193,239,103,196,173,247,149,146,204,177,19,184,157,144,9,95,244,116,64,202,247,99,121,246,19,7,26,179,197,125,195,102,185,22,95,43,244,99,84,14,198,145,211,58,226,204,174,133,188,233,221,85,55,20,125,31]	t	2HH2hhrE4BGBn8K8Ae5xC56J2RmKAbrdiW9vdMqvpump
28	2026-05-11 12:48:32.476641+00	[17,3,43,170,111,246,7,62,55,73,68,81,116,21,26,62,62,197,124,52,98,249,12,253,184,145,92,102,64,33,133,214,232,225,252,239,103,157,160,135,192,194,88,60,201,33,34,194,56,58,152,220,210,176,233,239,110,147,32,98,49,130,210,31]	t	Gg5T9cwryt9r4BUs12DKHw7wKhPS3sVaPv9XCz9zpump
29	2026-05-11 12:48:37.326309+00	[91,223,59,69,57,56,96,129,68,191,244,28,105,161,134,36,202,171,84,165,221,138,105,17,255,20,106,221,115,249,6,114,63,88,188,151,2,243,129,188,2,75,0,151,243,179,180,69,34,252,83,200,145,211,143,138,190,0,203,222,23,141,74,239]	t	5GHAX8L4f7f6NXGoL91uujtKWzKtMfRBG4FJVJJupump
30	2026-05-11 12:48:42.775032+00	[220,77,247,208,12,46,203,253,104,124,46,231,93,55,51,36,55,193,78,40,71,87,61,238,23,212,74,122,244,245,232,106,172,20,246,157,29,136,166,242,177,82,138,232,194,146,246,232,189,179,200,56,20,35,161,157,159,60,195,211,196,118,236,111]	t	CajfX1pgxzDedJa9rVWNDK1wY7e8TWcmzf4ooUtqpump
31	2026-05-11 12:48:49.223201+00	[151,175,153,178,112,158,189,227,214,134,82,103,9,215,16,234,114,213,235,29,70,17,189,133,85,57,171,214,187,162,147,148,183,218,114,37,141,196,7,50,153,85,210,190,193,208,79,130,36,166,54,20,67,2,129,204,88,191,7,229,173,44,179,111]	t	DNgobS3uWChPNQjAZEbYt3sdfzpBKT6pMuQz21pmpump
32	2026-05-11 12:48:55.169014+00	[238,112,246,226,41,232,66,93,56,6,1,112,183,132,222,78,186,25,156,7,56,31,215,89,116,62,234,17,194,172,190,241,119,182,119,231,208,249,65,222,74,93,83,43,194,177,248,62,139,194,137,114,213,132,112,224,193,150,181,14,173,199,162,207]	t	94JtjfsqnhTktS2V52hmWjq6cwvCcbtZTVdCHf9hpump
33	2026-05-11 12:49:00.937725+00	[7,195,54,169,154,134,71,156,158,86,54,66,26,48,123,197,87,101,127,150,202,81,27,178,95,37,186,50,137,119,239,110,64,46,152,174,64,237,63,21,203,214,111,225,91,157,86,36,176,172,8,134,254,47,128,226,72,189,53,232,68,241,89,111]	t	5KYJZUWzDFbieuFzyRmwdXsWHeqWjAgSpscXV48hpump
34	2026-05-11 12:49:06.268016+00	[205,203,200,181,124,67,246,122,138,228,158,15,215,52,129,94,81,45,124,198,117,125,13,218,232,77,252,34,87,21,35,27,185,214,244,6,160,20,214,253,195,238,85,214,247,29,109,175,187,166,41,138,126,200,40,19,199,173,200,159,41,114,52,207]	t	DWSXjH2gBvh25o3CZbQA5A2d5Y1HmKUhTAUuMW3Rpump
35	2026-05-11 12:49:11.536543+00	[201,68,172,165,18,23,18,130,45,41,197,40,155,16,65,115,156,168,26,234,29,117,14,11,54,135,105,162,32,217,101,101,6,118,15,212,236,43,98,250,129,210,232,187,34,248,221,10,226,86,64,155,147,39,27,219,130,228,228,9,164,80,207,239]	t	SDrvKkYzZdfyw6WVh5DPANPGyiojd7MD3qwxLJupump
36	2026-05-11 12:49:16.940785+00	[105,65,2,247,224,117,189,71,174,81,165,147,223,38,197,231,141,239,85,238,206,212,246,173,203,182,175,253,163,63,248,181,50,88,1,183,141,205,4,144,127,195,123,116,117,82,250,198,216,203,77,251,25,173,61,148,183,21,47,190,45,160,40,111]	t	4PXDfvKn95MDaFA4nTCC7auJNDEpUuqTnoaghBoPpump
47	2026-05-13 12:26:34.078607+00	[196,8,152,238,139,205,109,209,149,242,24,54,7,135,200,178,175,8,180,175,238,23,252,152,51,68,178,246,65,40,149,98,74,87,107,246,210,24,73,166,79,153,137,5,77,219,119,174,103,216,128,178,121,22,216,111,17,237,133,24,238,234,74,127]	t	61CVBS6RGZszHcyomEu2XgUXyLK9SompoDrtMXFxpump
48	2026-05-13 12:26:34.103797+00	[105,94,33,142,227,76,171,195,137,69,225,2,161,203,183,124,106,127,0,88,233,156,153,220,94,230,5,237,229,111,68,185,101,62,236,220,128,10,162,29,189,72,60,101,20,128,23,67,8,15,101,175,60,84,139,20,85,133,118,1,142,56,73,191]	t	7pDq5LQnoEnP7ZdapQfUVdikYCcGBWTGmF2qXqMgpump
49	2026-05-13 12:26:34.119081+00	[145,108,75,227,115,228,46,228,76,162,81,129,193,93,186,65,67,212,85,120,186,182,6,173,45,194,245,27,121,201,167,108,153,233,150,2,75,64,87,51,163,125,55,207,58,152,231,101,205,166,35,34,126,65,155,15,153,151,232,172,72,42,218,79]	t	BMoxpS3dZLGwAbwrdFN26WkPhpWWuFseQBtMez1Dpump
50	2026-05-13 12:26:34.133017+00	[148,50,31,154,23,222,8,201,209,68,185,190,167,32,0,179,195,33,70,243,56,96,79,42,154,246,191,183,149,136,195,175,44,3,186,187,196,69,17,112,228,128,192,250,197,62,71,233,0,90,89,228,182,128,62,187,148,212,252,78,124,6,139,63]	t	3xpEkMedUcXCm5XR7iXBVF6xChyUNt83cJo6gPDYpump
51	2026-05-13 12:26:34.146378+00	[22,246,232,230,160,146,0,203,130,87,100,45,132,162,101,224,84,51,189,82,202,129,145,71,111,238,249,46,52,82,249,111,143,128,196,175,184,223,36,92,216,216,62,182,24,196,80,42,143,148,93,16,101,153,245,111,168,38,116,70,178,70,139,15]	t	AfBBgPZANog4W9Kxo7QAfiBracMTwKsqZYR9CevPpump
52	2026-05-13 12:26:34.160379+00	[150,237,177,239,197,121,44,176,54,185,41,168,97,19,102,140,133,67,142,104,118,110,160,198,78,254,207,9,26,27,50,64,99,239,91,60,164,115,190,248,65,184,32,171,241,243,145,99,142,19,184,229,203,27,223,173,38,137,18,82,177,168,137,127]	t	7j73uVWfjcZj7E9zHq9X5u8t1W9di4buBjUBf4zvpump
53	2026-05-13 12:26:34.175129+00	[10,200,232,105,127,208,107,232,174,148,230,209,220,56,63,183,147,46,241,7,31,158,12,168,185,213,57,163,89,248,13,35,94,2,214,45,160,169,241,199,61,177,100,164,47,208,74,166,126,245,24,28,40,246,146,143,85,107,3,15,147,39,73,175]	t	7KyqGwAeXFC36HYKHYG8hG1yyiMdCnPn3N1eDABPpump
54	2026-05-13 12:26:34.189432+00	[47,212,169,5,233,244,216,96,159,127,55,40,109,113,223,51,1,172,94,22,77,31,219,119,82,96,160,253,175,172,20,120,179,195,242,167,232,241,118,26,217,104,191,36,185,24,241,218,238,228,196,252,164,152,215,192,188,149,37,93,222,185,109,63]	t	D6jGxkSJj6A464tac21ep1RJTkanZ4EG4XSJHHVppump
55	2026-05-13 12:26:34.203246+00	[227,42,3,78,95,17,188,228,224,123,50,123,213,81,221,198,228,19,32,122,230,183,204,79,242,84,28,23,196,250,126,216,195,197,193,64,62,164,40,60,181,58,135,208,3,147,74,185,91,63,203,115,163,104,224,187,82,11,207,38,241,80,249,223]	t	EBDPznVLNSSZutp7UzoYCxvsSq2EZ8FSSpncS2mEpump
56	2026-05-13 12:26:34.216147+00	[111,125,0,213,28,90,205,53,180,165,158,215,155,120,36,187,156,75,161,176,30,74,214,71,187,124,52,182,20,245,231,45,164,88,225,231,106,195,67,87,117,24,231,108,216,53,190,130,246,241,148,32,65,128,32,166,50,248,240,154,203,182,106,15]	t	C4YUHoMU976BL4MRAhuJQ6iEndmbbooD3FQVDyNKpump
57	2026-05-13 12:26:34.23012+00	[126,244,247,74,94,216,158,34,88,243,109,156,207,220,50,193,81,159,64,35,31,229,61,68,48,48,168,117,209,148,10,237,189,141,122,45,248,163,156,222,186,154,216,131,109,42,86,244,33,24,21,190,91,106,38,170,244,204,101,81,101,154,123,111]	t	DkwBL5nEMmhfv2BRgMEBGg2d3YePgXoKfZmyKvvdpump
58	2026-05-13 12:26:34.243201+00	[75,214,183,115,91,164,51,204,54,215,201,140,127,40,208,97,159,86,74,68,19,55,246,229,225,237,162,54,227,122,114,134,145,105,154,76,242,162,6,194,235,42,20,15,113,204,10,208,147,231,128,56,161,115,233,247,57,130,140,210,222,156,104,159]	t	AndWgbfSXZRkzuSc4vs7EJckjaZSzPg8aP7EmeAYpump
59	2026-05-13 12:26:34.256585+00	[163,184,245,173,17,61,167,159,156,1,133,31,135,83,88,170,205,70,242,133,72,33,179,149,227,30,6,233,38,22,55,15,131,54,15,55,199,198,7,244,157,120,245,248,23,130,1,226,84,2,223,35,218,138,125,200,110,23,176,109,46,11,220,15]	t	9qCDhE1XP86uq4LKMaUkJYKbc4rmoQT4LPLAUTqdpump
60	2026-05-13 12:26:34.269849+00	[52,10,236,104,39,139,59,32,9,81,13,18,228,209,163,67,132,143,51,49,28,28,3,197,62,197,77,78,52,62,49,128,33,241,114,61,91,138,112,124,140,20,115,131,212,78,91,234,8,148,187,178,74,180,170,34,143,178,97,128,86,155,4,175]	t	3HVzSQrMNZdJzxJWQaN8a2efrwP1G1wLHWZvwLPPpump
61	2026-05-13 12:26:34.285172+00	[138,48,76,234,114,254,246,225,47,118,56,67,218,45,36,132,95,65,74,68,120,173,195,56,128,103,94,45,163,108,210,51,137,160,41,103,96,1,63,140,69,94,38,27,203,120,208,204,233,233,34,71,68,98,137,178,2,90,51,247,171,132,212,111]	t	AGEW9DYmjR7oC8PcTkBbxxyAuwGvYKkKSNRm7hkmpump
62	2026-05-13 12:26:34.2987+00	[31,123,233,241,187,65,49,219,170,123,234,106,158,146,199,77,17,198,147,88,132,26,32,169,118,5,46,206,98,142,12,108,245,87,103,1,83,68,10,71,13,152,56,185,12,160,207,22,23,204,2,206,120,53,92,137,179,43,1,213,67,78,174,255]	t	HWiBjVZ9nSBHW1tTK7YeWeKGBBmsoWgjbXyy8YSvpump
63	2026-05-13 12:26:34.311146+00	[19,191,203,112,33,204,19,119,131,77,158,35,157,241,111,202,149,104,223,183,176,166,34,67,103,97,37,187,153,111,222,69,69,242,72,160,82,9,81,118,176,139,183,142,125,194,247,5,51,62,20,100,138,250,255,69,44,252,17,178,64,184,130,47]	t	5i3QfmHNXhDpSnE6vD7tdRp4bi8yxaP7STsvzrMspump
64	2026-05-13 12:26:34.321866+00	[140,222,205,143,84,195,202,216,197,114,211,0,240,62,178,185,123,245,83,255,139,4,103,160,73,139,123,35,179,183,136,191,212,89,209,41,188,135,220,74,166,233,20,232,50,64,129,143,21,105,122,250,33,192,174,203,214,227,75,198,183,11,46,79]	t	FHvsG9usRgCGDCfAYXfxmDrSVKAnnv5Ho6utF43ypump
65	2026-05-13 12:26:34.335789+00	[213,67,59,228,74,252,107,114,156,129,80,44,113,90,36,233,181,137,26,206,151,197,131,237,159,234,0,214,34,26,154,222,191,241,241,153,205,68,218,2,195,8,121,85,146,169,157,220,144,214,172,236,121,184,127,232,95,133,222,151,141,27,169,143]	t	DvGr6osPfqUZcAxJbGPb3XsHNozrB24mbtofFBUPpump
66	2026-05-13 12:26:34.347933+00	[0,30,122,132,241,208,246,247,111,222,122,71,89,166,111,229,26,116,221,98,212,169,6,28,140,99,134,89,93,198,242,89,227,167,16,40,197,237,99,206,143,62,0,230,99,73,21,202,240,77,27,248,163,195,113,254,80,176,29,46,217,115,184,63]	t	GKfJLNwZcyhdWeE5HCTHk39cQrL2ogU3DUkQMVaEpump
67	2026-05-13 12:26:34.35803+00	[162,113,41,0,150,171,239,31,162,10,202,27,140,163,223,10,20,188,122,147,237,37,218,106,97,213,153,246,206,100,98,17,246,126,170,16,68,69,50,157,55,242,219,26,177,62,255,158,209,245,57,12,23,8,115,247,234,249,63,181,26,47,75,127]	t	HbDKLivwry51BhMuho9kLVUcyxKnuvmzerBUHQhYpump
68	2026-05-13 12:26:34.369766+00	[158,73,6,19,250,28,188,90,215,158,107,197,226,146,84,111,154,207,49,138,35,84,65,51,85,67,67,235,235,202,207,8,97,165,60,5,111,178,224,69,131,85,0,11,94,193,92,149,73,183,133,157,87,100,94,186,125,150,203,123,7,196,68,63]	t	7aAgVTuEMgjEmYyUsyLT2JWUJbMqRVdQYa3yaxP8pump
69	2026-05-13 12:26:34.381179+00	[12,117,85,60,114,37,132,43,110,97,55,67,211,82,8,119,113,181,34,17,224,65,249,210,56,73,6,10,200,13,37,54,64,251,103,8,69,95,98,207,33,25,194,68,32,213,4,165,103,32,150,111,198,78,199,183,114,96,196,97,211,249,6,143]	t	5NfSBuP8A6sHCqGkwMSSqbCd1ovDXEgtJPRWzi5Rpump
70	2026-05-13 12:26:34.392142+00	[129,83,114,83,48,66,52,122,215,29,188,81,44,12,106,18,197,127,220,241,221,13,5,26,110,75,199,34,236,188,243,27,29,51,171,147,86,35,126,253,37,213,134,19,47,211,81,201,28,227,191,105,15,40,12,69,253,243,62,195,93,195,252,79]	t	2xzXCRVxsZesCWn27RufbzdVS1TVE7khWbFn9NZMpump
71	2026-05-13 12:26:34.403674+00	[32,14,114,169,190,53,34,245,107,74,116,144,168,229,126,211,174,141,35,178,108,251,144,84,146,206,53,129,196,179,121,156,194,32,193,170,98,55,159,183,20,39,14,164,41,81,200,229,131,109,229,122,96,174,164,199,216,236,74,83,9,104,10,175]	t	E4o4gEKNLzzo7x8N6B1sxQkg55fex1x912KXUEtdpump
72	2026-05-13 12:26:34.416037+00	[45,250,189,112,240,46,20,199,247,233,102,85,53,168,174,145,163,65,129,223,168,43,6,100,63,89,46,67,40,224,136,72,57,55,138,169,49,138,134,81,103,24,35,166,161,2,31,84,176,125,24,47,86,33,104,195,30,41,153,201,103,100,5,95]	t	4rMMtKiyJntwHydyGMczUxTYfVdvW9EvNguMnS6kpump
73	2026-05-13 12:26:34.428312+00	[17,166,184,76,104,35,94,230,25,173,250,53,166,16,164,92,7,236,246,118,244,173,230,218,11,95,139,185,226,171,133,134,169,206,207,247,101,232,204,63,31,44,248,114,216,45,175,31,68,252,74,11,136,109,17,222,230,164,103,62,123,88,152,47]	t	CRrooB1vQWP2kSGadviCrNdi8PLWTXuZDBvPReGVpump
74	2026-05-13 12:26:34.43806+00	[249,92,119,239,215,189,184,146,238,92,80,199,84,149,15,19,230,40,74,110,9,188,111,167,44,234,112,120,132,115,132,47,120,250,167,162,56,140,200,154,32,9,82,21,97,136,193,111,35,132,249,109,31,246,3,131,209,105,175,106,110,25,8,79]	t	99Fc3Gqa9sQXAWX9h9ECspKY6izVsyM8Vu2pVimmpump
75	2026-05-13 12:26:34.449598+00	[177,207,31,8,238,243,53,254,36,179,130,8,215,49,24,159,72,229,190,51,22,212,97,126,36,189,26,105,110,191,14,24,95,66,163,28,178,200,150,199,104,9,149,127,3,184,230,12,132,35,75,29,71,255,181,247,108,103,255,229,45,246,187,207]	t	7QrfbqCeZAsuCce8btiQgJVZMMPboh5rZLyc4bsDpump
76	2026-05-13 12:26:34.461149+00	[95,247,27,192,42,111,11,88,216,236,232,30,1,184,90,245,24,14,236,154,254,192,210,79,235,245,117,204,149,239,154,30,114,140,112,98,71,200,39,191,158,188,145,211,63,56,171,40,80,237,117,147,7,243,39,173,192,124,58,123,164,62,129,79]	t	8i9gaxW5cJyMUw2wpLuEKVdiwunvXPWLhTtYWwTMpump
77	2026-05-13 12:26:34.471422+00	[27,115,42,24,76,252,213,71,187,128,155,153,252,11,219,42,248,134,96,18,123,16,173,31,164,167,179,150,84,207,12,251,39,246,41,104,21,35,250,100,29,4,11,186,114,76,171,194,88,121,16,193,150,132,207,198,76,45,8,157,138,239,27,15]	t	3gzcCduYJAmk2cyz8vEF5bD8jbnze7g27eTk2Cwdpump
78	2026-05-13 12:26:34.481394+00	[192,136,243,81,225,0,170,79,58,100,223,193,100,53,40,185,194,103,132,192,69,52,71,24,42,109,163,205,252,202,182,203,99,218,138,216,254,0,148,173,114,109,135,60,158,0,104,61,23,34,100,79,252,187,10,89,126,22,250,115,230,8,57,175]	t	7ineEttD6gNtJPQ1Eij5wawnwD2NiayxV8Dfj4Zspump
79	2026-05-13 12:26:34.492215+00	[159,33,118,202,98,117,90,211,48,15,87,218,128,44,85,202,65,148,200,37,148,59,139,192,255,239,159,167,114,121,29,68,130,13,154,49,109,185,170,6,51,183,166,64,188,92,132,36,139,190,127,124,230,92,141,134,29,182,109,85,218,136,184,175]	t	9kg2nAU1SZUNSR1hDc5DDho55BFBpfCWBca4LNC5pump
80	2026-05-13 12:26:34.503206+00	[224,80,254,16,96,155,23,246,121,54,162,75,222,139,3,59,49,50,8,212,180,109,135,89,182,74,48,38,201,170,37,19,138,70,159,130,38,46,23,39,2,94,195,216,236,242,109,241,220,40,172,202,158,110,122,155,62,80,95,5,31,138,244,191]	t	AJmiroUP3xK2HFXaCaHk6hqhsodyrV3nWhnXmSzapump
81	2026-05-13 12:26:34.515558+00	[218,132,245,105,214,66,133,170,251,254,56,46,141,215,67,75,10,39,22,135,166,102,16,111,137,215,13,216,33,212,193,231,134,140,55,231,119,78,204,90,226,219,136,170,188,252,242,172,253,116,191,7,246,17,119,47,133,124,5,32,186,74,151,79]	t	A4DeCUZx2tjWFTRPcsQ6Rvmu87YgrGHVCqJbWd9Zpump
82	2026-05-13 12:26:34.526717+00	[129,12,50,169,217,101,199,123,222,175,180,251,249,111,103,95,110,123,132,81,168,233,248,139,30,117,21,226,148,113,104,22,136,128,97,178,146,179,50,24,119,160,180,117,31,222,28,78,58,234,220,199,198,243,206,133,66,165,122,179,192,183,132,191]	t	ABqzKWYzVRt8Agq7i1vKRCdHeo5UE5rREtudkofcpump
83	2026-05-13 12:26:34.538638+00	[132,7,232,172,48,175,31,70,128,93,92,63,5,254,131,163,214,114,149,193,69,252,141,121,41,24,202,8,242,55,118,7,118,46,165,207,239,6,61,188,132,146,195,49,110,49,153,75,146,157,156,13,189,181,121,223,52,175,5,139,195,27,195,143]	t	8xLN6q6NW7J1GaUESS8XjwMW9cpNAUZ8FfDy1a1hpump
84	2026-05-13 12:26:34.550406+00	[212,80,117,57,176,52,33,126,235,210,87,31,255,215,46,125,210,56,185,38,245,87,250,210,155,136,121,177,44,254,217,124,150,217,48,224,240,164,57,225,247,103,26,133,183,208,136,184,26,239,57,176,170,239,84,161,49,64,250,10,161,194,53,175]	t	B9rEtRqWjrjmG3eM8BwYKoFh7tFqxnsCSD93aXfspump
85	2026-05-13 12:26:34.561663+00	[49,75,49,126,5,20,248,253,182,144,245,23,67,31,111,178,47,177,68,250,229,236,112,159,32,138,111,206,42,82,218,169,42,241,4,160,128,227,38,74,247,55,253,129,28,60,183,131,217,46,244,167,175,112,188,240,213,58,253,47,101,186,117,47]	t	3tdHHzQHAmnyzQG3oPDaC8jkcnaTPT97YGLNZFyopump
86	2026-05-13 12:26:34.573417+00	[77,115,167,229,149,102,95,61,122,32,159,3,27,145,146,202,112,228,94,0,106,110,66,249,7,232,251,206,118,190,39,149,66,107,150,218,115,215,197,244,212,106,74,161,122,159,6,110,187,203,184,128,118,162,68,250,253,118,211,11,11,30,143,239]	t	5UH4Wgnt8RsWHzcjy6E4Uy1eDhHo4kSRhsUqT5dBpump
87	2026-05-13 12:26:34.585488+00	[57,246,30,67,183,107,58,27,103,171,235,237,246,168,14,30,80,161,49,221,34,114,118,47,4,46,182,136,10,2,47,139,255,250,46,119,233,56,227,13,30,199,168,35,129,64,4,219,46,128,214,232,142,174,133,142,151,100,202,213,108,23,243,15]	t	JEEE2zkeBEyJ21TMUwFpcYJAZYW5ssiHHrkGmMTZpump
88	2026-05-13 12:26:34.596051+00	[72,113,0,231,175,210,45,22,178,254,237,102,124,214,118,108,204,167,188,50,58,214,226,233,207,219,166,125,184,82,131,237,185,74,72,22,150,30,92,19,242,244,70,192,174,208,49,227,32,86,98,31,25,90,41,191,92,211,248,2,217,23,233,47]	t	DUJ7ufknTGKB2JrXWbvJfFLhx3vnn55V6WsjK7Aupump
89	2026-05-13 12:26:34.605918+00	[84,164,103,255,51,236,85,61,37,100,95,129,188,4,42,27,213,154,46,174,141,30,144,144,75,214,251,96,44,101,151,63,35,7,123,101,7,125,29,168,153,152,208,10,13,122,186,221,228,128,231,103,138,237,29,57,1,54,137,25,188,41,249,111]	t	3MjtRMT1Z79enGjktEyfvMg2VuyESK7sFREBARtupump
90	2026-05-13 12:26:34.616677+00	[165,124,118,159,232,145,144,19,60,19,142,198,83,248,232,250,48,168,241,134,56,248,149,171,216,49,161,46,14,181,27,231,170,26,224,174,198,248,161,4,47,87,39,182,87,101,229,112,211,2,246,49,94,60,171,47,221,226,197,81,33,199,93,207]	t	CT25byvMQPGg7ikeTCWhwCAc5T2ANq71iiRqQUGfpump
91	2026-05-13 12:26:34.627743+00	[0,24,237,90,229,49,38,9,154,205,119,108,162,112,103,119,4,190,12,96,224,143,140,54,35,95,234,168,77,237,118,191,236,222,135,100,226,4,155,235,150,85,127,44,233,47,232,63,217,107,58,242,143,7,167,7,69,238,24,206,180,54,108,95]	t	Gwe2JAaFGLAwRPNuJiXwjHjLgTZjz55pxw6BG5jWpump
92	2026-05-13 12:26:34.639285+00	[10,251,182,80,164,58,199,141,42,32,37,52,105,179,118,101,145,107,37,16,238,127,183,148,153,217,193,240,14,198,223,174,62,77,94,162,37,217,4,218,126,209,51,163,178,136,238,22,246,56,121,49,168,65,162,146,244,97,74,8,26,30,156,95]	t	5CChoBJtXaZSaC9JNAYt9YE3qL3DG5Ybde4nzzwrpump
93	2026-05-13 12:26:34.650574+00	[209,111,108,144,57,215,167,194,143,57,151,97,217,193,238,249,238,104,227,144,42,15,193,32,3,199,38,188,39,142,153,197,107,166,88,240,217,210,231,135,68,83,250,64,97,207,78,7,235,110,95,8,62,201,237,214,88,142,67,152,160,75,208,15]	t	8FDk3eb3e8jhrNv2EP5LZMcDatEtpQboYw9wZg8bpump
94	2026-05-13 12:26:34.662614+00	[20,30,127,138,213,22,22,28,142,153,61,200,199,140,122,62,80,131,95,94,149,7,255,90,177,162,33,17,66,208,107,138,238,3,168,185,217,58,223,39,237,193,204,122,176,224,217,69,115,106,100,69,0,101,230,151,148,196,174,149,2,92,105,127]	t	H27GZANoiqfnLNCVVL5MWcSdntSMrt36mzHvdXPQpump
95	2026-05-13 12:26:34.674527+00	[102,152,237,68,154,84,193,184,100,192,179,177,117,84,78,132,28,175,1,60,2,6,76,200,105,189,168,119,33,27,66,143,72,130,188,153,209,147,146,13,41,119,215,201,254,236,189,2,34,185,93,206,123,137,135,219,166,247,15,146,211,63,80,239]	t	5t3ykY1aP6PAyLKmpvpcEDso1FNc7To3B2oVYZvhpump
96	2026-05-13 12:26:34.684832+00	[17,42,92,71,175,162,109,42,52,103,183,165,129,137,193,241,242,15,32,102,142,105,23,56,164,157,133,135,226,61,178,251,118,37,222,118,214,133,49,87,192,172,150,245,86,122,97,221,211,41,127,214,144,186,16,242,83,149,29,184,101,177,195,159]	t	8xCbnyFY7yTxssihV5vX6H2Q4CpqNUKhGt9CsBBJpump
97	2026-05-13 12:26:34.695045+00	[34,230,138,233,162,188,145,120,149,38,176,175,9,239,12,143,168,62,218,242,184,10,217,62,47,47,161,96,7,216,127,230,203,193,139,184,113,73,4,185,114,101,170,95,111,205,161,152,37,227,101,125,177,246,68,135,183,94,166,202,53,28,189,143]	t	EiNwG5eaDikwXqAvEySnBjCFwRdJdYYwEW55XKvspump
98	2026-05-13 12:26:34.705695+00	[236,154,146,135,30,82,211,53,19,201,67,186,88,217,246,39,82,124,109,100,73,169,73,21,113,246,153,250,147,238,158,125,72,140,28,216,44,135,236,6,84,241,136,83,64,92,65,222,206,119,253,69,13,154,43,113,247,38,188,231,253,1,185,239]	t	5tCGhHqUpX631XK9A5msWt5usggfbKYT3LtPu4hwpump
99	2026-05-13 12:26:34.716212+00	[158,123,48,16,241,224,6,58,18,241,135,132,78,120,0,121,192,210,196,39,53,60,6,251,174,207,68,216,101,182,158,54,28,152,174,240,25,108,204,123,241,36,181,10,251,1,94,155,48,208,105,63,32,157,185,73,157,90,32,58,192,144,18,239]	t	2vdT51RBbXTmohJ1wCmN1D7Bd4ZUBYa3yPdcbj5Kpump
100	2026-05-13 12:26:34.726914+00	[133,201,148,193,119,106,220,187,164,125,140,89,198,38,24,172,240,16,157,111,239,221,140,170,39,42,214,204,65,190,180,236,107,228,127,166,221,186,120,76,232,243,40,122,102,79,110,128,15,211,107,147,176,252,140,33,55,38,213,153,44,113,247,175]	t	8GAi88XABTdoPZTbavnC88LjoW7wGihnH3AZ2Pobpump
101	2026-05-13 12:26:34.736752+00	[233,100,77,50,231,234,43,44,2,37,247,163,1,114,24,229,142,201,111,183,233,189,161,50,205,141,61,120,112,43,187,215,51,28,205,105,93,223,139,200,44,164,0,1,99,84,43,125,218,69,207,13,90,245,206,165,143,47,172,217,115,111,52,127]	t	4SXGQMrf5MpQbUCAnYeSm8S2uJauYuaMHTJoQ55Upump
102	2026-05-13 12:26:34.748247+00	[51,56,205,247,186,116,241,7,26,56,177,88,210,50,17,173,190,214,162,93,125,51,89,188,100,239,9,80,83,195,83,2,197,19,2,24,95,92,3,147,79,15,122,55,18,24,162,165,215,213,234,124,62,53,221,153,251,32,251,202,63,149,110,79]	t	EGJ8PZ2DRwNLMRWtVGUyo5c83XUJsNru5KboqDQspump
103	2026-05-13 12:26:34.761036+00	[59,179,153,95,129,37,176,22,167,158,203,5,164,166,166,164,96,93,30,77,0,197,16,75,185,187,207,100,43,15,133,205,70,254,8,241,240,128,252,8,70,235,84,86,191,113,135,180,160,0,117,74,77,60,53,230,112,57,223,140,214,191,198,255]	t	5n8D6quW4JLzJakwBMPywiBurXZ2uqpHguQbDvLrpump
104	2026-05-13 12:26:34.774024+00	[212,55,224,206,43,134,222,73,7,239,222,15,10,122,165,9,16,139,252,112,242,137,236,85,11,13,218,98,8,45,248,173,161,253,163,6,18,22,49,48,164,15,68,164,52,222,73,111,219,225,44,173,90,76,199,109,78,66,183,84,54,1,189,111]	t	BuLxWRM2QroUia2RsZYxtDvWqQokESC46BZtauNZpump
105	2026-05-13 12:26:34.783931+00	[111,189,214,160,137,95,18,65,197,61,98,244,109,145,10,27,70,113,21,90,101,81,238,61,93,83,211,69,22,246,225,187,105,15,161,251,115,83,84,14,66,68,146,83,119,250,162,1,95,126,14,172,46,249,253,30,188,104,109,176,92,125,249,191]	t	857dmaiunsdHmgZDC6aBc3iM42xjLs8svtMkAbxipump
106	2026-05-13 12:26:34.796042+00	[183,202,106,126,24,19,173,199,117,47,218,142,216,57,174,220,205,227,105,156,192,147,34,200,126,233,185,183,109,217,0,237,233,16,199,240,237,238,215,159,30,151,93,29,204,109,98,120,243,189,121,129,83,54,19,17,182,114,90,84,9,245,182,175]	t	GgnqRG2JWgUHGgsf3Xc8RguE2Wvw4ssW4CaMHMG9pump
107	2026-05-13 12:26:34.80786+00	[152,187,19,231,50,31,177,161,95,152,212,213,250,127,132,24,92,200,66,107,10,197,7,25,241,221,191,204,8,159,181,189,220,104,90,63,17,18,131,245,137,131,253,88,158,119,237,137,179,21,241,79,193,249,224,61,250,132,102,110,219,151,129,223]	t	FqNz3BysYXsb2Z2RWFANs4mH6adWKn4dC2AS12EUpump
108	2026-05-13 12:26:34.818302+00	[0,90,18,106,128,75,14,245,76,77,42,203,9,152,27,6,44,2,167,114,113,125,84,51,154,114,204,152,144,26,232,80,153,164,171,213,189,133,42,203,63,3,104,166,89,25,72,134,38,16,94,183,165,97,163,171,226,240,167,225,115,129,115,239]	t	BLm1oX3v824Wxjgm7hGdTtstRunxKH7y7oTuZu1bpump
109	2026-05-13 12:26:34.829452+00	[105,53,141,63,227,104,207,199,188,223,235,63,232,208,158,27,12,177,84,52,109,237,52,76,145,34,35,154,66,241,71,80,237,40,240,150,49,186,240,231,11,239,180,73,157,97,246,249,25,179,131,171,92,234,150,41,227,115,150,9,87,233,248,191]	t	GxmqEwGj37aCEy5jCR1eWfKXx3e8QLfy3RtWtpz2pump
110	2026-05-13 12:26:34.840266+00	[102,172,41,163,195,119,234,63,14,248,242,145,0,26,85,230,81,110,78,167,43,51,227,136,116,254,47,244,115,141,44,204,0,129,65,103,236,96,240,106,109,111,241,82,46,203,103,155,200,181,1,179,58,144,153,166,86,54,54,143,197,43,110,239]	t	12yKE1byTqt4J1uaxmFDQDm7J9HeNvo32Wfm3UbKpump
111	2026-05-13 12:26:34.850852+00	[19,104,158,10,30,160,136,221,222,41,187,15,158,190,42,232,69,236,199,29,44,190,23,121,4,86,28,139,198,35,223,202,146,234,95,6,117,0,163,225,64,72,91,11,194,130,24,246,134,118,62,39,208,137,212,186,188,197,26,71,199,248,53,207]	t	AtVoa6xGGHD3Hw8g5852gdkJXBNWjVsQHNiGt7xTpump
112	2026-05-13 12:26:34.861869+00	[70,214,157,104,250,210,58,153,20,19,124,192,30,43,185,55,25,163,94,167,147,73,15,237,16,122,155,174,59,191,97,39,8,219,135,5,209,151,188,64,10,60,20,148,102,132,53,149,49,109,91,64,206,91,119,194,9,187,201,159,199,109,202,111]	t	baQwWhwft9noxLKGsq8UU1JMS6tn33N8L9rZzzVpump
113	2026-05-13 12:26:34.872082+00	[132,234,222,116,48,136,75,17,108,181,84,20,196,40,156,62,136,5,60,216,184,16,124,26,159,137,83,154,88,115,162,215,155,218,200,197,134,129,116,66,233,22,150,39,120,105,224,7,251,167,193,148,39,35,142,48,244,124,242,103,177,166,199,175]	t	BVPgrHfJGa6i8KanzVE23oAnCqWU27v6gsj7XTqPpump
114	2026-05-13 12:26:34.883496+00	[133,178,135,118,92,240,134,44,103,187,225,198,95,246,97,14,249,237,65,202,162,101,146,83,98,168,137,152,86,107,24,213,220,206,149,41,168,40,44,51,33,219,194,205,193,95,12,219,174,212,52,197,180,39,128,16,64,244,157,63,44,139,171,239]	t	FrwPz37pb7Z6fauJMNn3byoXDtwiuaHN3Pctszempump
115	2026-05-13 12:26:34.893536+00	[184,209,122,99,3,248,156,178,250,162,161,81,146,186,94,167,212,194,145,246,23,2,245,44,98,197,86,132,133,52,235,139,83,27,120,76,112,100,49,199,119,88,37,147,136,206,185,143,213,135,135,62,49,118,122,95,63,166,121,4,247,201,40,63]	t	6bR8jvCokoTQMJnMy92sKp6qttnmuF8wNmXzMwPcpump
116	2026-05-13 12:26:34.904393+00	[206,131,223,114,21,79,247,255,176,96,10,142,183,104,74,22,235,137,104,62,254,134,21,79,191,151,234,0,75,128,54,227,161,17,201,251,104,139,212,139,79,189,164,177,122,135,116,60,208,12,179,27,36,103,25,1,200,244,40,250,243,189,171,15]	t	BqkNaTXKXzQ8rtKYp1rVJHd7RhxGWvsXXsQXLZ5dpump
117	2026-05-13 12:26:34.916009+00	[139,37,126,174,175,0,80,158,209,147,244,128,130,104,49,8,99,131,106,204,109,55,136,163,47,230,66,82,207,68,84,148,90,99,142,149,136,102,123,145,136,245,157,44,149,165,164,43,111,231,106,109,86,12,134,175,246,255,193,52,80,232,167,31]	t	75qk1MxuY48V8BVheDsWuKVRxRSmm11cXLMcNRKApump
118	2026-05-13 12:26:34.930972+00	[119,131,63,85,154,34,8,95,152,127,142,94,155,41,16,237,54,149,53,202,210,191,65,183,44,10,75,195,7,209,82,93,207,116,62,182,149,113,14,149,118,253,149,4,104,241,146,54,91,25,45,247,132,131,120,29,214,153,163,236,94,31,2,175]	t	ExpCfSCyM2bc3oE7RTaR2RhCMp6SXENmvL8ynKufpump
119	2026-05-13 12:26:34.944383+00	[221,239,250,14,130,176,152,62,154,142,199,206,200,82,167,75,128,98,190,169,229,178,176,102,56,187,131,240,16,91,17,84,88,46,81,125,181,240,152,114,208,99,147,39,173,168,15,130,167,134,78,109,210,113,173,42,36,84,80,21,42,180,246,223]	t	6wDqp2DsoL79UxP8UwTWrExKYmT8gZ5Pddu4uhP6pump
120	2026-05-13 12:26:34.95644+00	[244,217,185,157,217,156,37,39,26,205,36,194,52,203,226,186,24,19,244,225,238,211,189,38,40,249,76,204,128,195,25,250,52,241,203,205,41,242,176,135,77,107,117,42,25,200,196,140,112,203,26,74,120,92,137,37,0,219,18,93,59,217,253,239]	t	4Zg3fgAYyM4LeTrZbwHko5fRptkVgDveAi7e5rHXpump
121	2026-05-13 12:26:34.968124+00	[4,179,37,213,175,112,1,232,133,163,105,59,175,1,147,54,57,82,110,194,114,20,202,163,213,152,85,241,9,160,85,71,12,122,146,190,84,73,149,42,150,119,142,34,158,36,189,4,90,134,48,202,81,214,220,153,3,12,176,0,215,72,93,175]	t	qiJDFyC3RpcVZRmC1nKxdj5VyRiyN8FCADN8uL9pump
122	2026-05-13 12:26:34.978783+00	[181,77,235,204,217,208,101,231,199,67,224,188,217,218,92,107,99,152,219,166,92,226,99,21,37,93,155,182,136,207,182,186,46,89,51,214,8,73,69,87,103,128,6,38,199,47,53,169,162,79,214,177,66,162,76,57,188,47,248,224,162,182,29,127]	t	47veRYTUUifNAbpMmA9J3HseMfV25DEGZcrfSCGapump
123	2026-05-13 12:26:34.989453+00	[105,132,208,225,190,215,33,194,69,142,229,4,149,21,119,103,122,149,92,156,91,112,86,123,207,112,103,156,246,154,245,177,189,161,24,254,149,42,80,155,3,233,225,215,80,60,45,219,252,248,250,249,123,169,79,75,141,132,87,188,156,216,35,159]	t	DmEXmQXGTMLzJYgMUYL3i61JhQYKCEjWbQsrSe6ppump
124	2026-05-13 12:26:35.001956+00	[109,19,155,100,77,136,8,175,89,237,144,55,53,29,57,155,119,6,135,31,157,232,161,2,88,11,144,102,214,130,23,148,240,88,106,39,21,70,165,78,179,6,33,118,63,5,116,94,142,25,66,49,214,229,39,156,219,233,175,29,68,13,167,47]	t	HBD3RjYv4rxyQ3o2ecLYruvZedPHbux8yZJk2PHwpump
125	2026-05-13 12:26:35.014253+00	[237,211,151,148,61,4,235,69,188,15,31,208,141,84,0,219,194,234,228,91,8,4,125,176,236,74,66,206,194,191,255,44,93,108,181,209,164,141,174,0,164,69,151,240,90,96,61,82,249,188,112,99,103,232,123,255,167,64,88,201,156,153,0,159]	t	7Hh4U4vq9XAcuZpkDe48S49vvgDS3eVjwqowApExpump
126	2026-05-13 12:26:35.02537+00	[243,195,69,188,75,3,167,52,63,215,46,217,115,242,172,168,29,119,98,134,75,148,31,101,174,30,61,39,198,203,228,90,182,83,223,68,63,27,184,3,254,218,188,84,180,78,109,109,157,230,74,167,131,136,243,238,112,211,214,238,81,2,4,175]	t	DGjNvNToE2mShNBRMeKQYNNxG3V7SVSArPGvikoopump
127	2026-05-13 12:26:35.037377+00	[6,13,46,104,7,16,201,176,103,85,117,68,188,253,121,110,242,28,65,20,46,149,212,13,33,6,63,148,117,172,75,50,127,30,166,208,120,28,175,25,192,94,176,222,46,224,92,161,154,146,222,47,232,65,173,203,228,44,9,138,16,128,35,239]	t	9ZDtPiRDC14pTMP5z2uuZjnkZs5hmqzZGzcvPqwPpump
128	2026-05-13 12:26:35.053707+00	[37,139,106,36,151,154,229,198,165,83,74,38,110,253,193,62,253,119,248,242,191,147,206,46,59,212,10,147,101,251,62,236,170,58,0,59,82,31,40,105,205,113,40,124,41,165,221,44,247,131,198,15,93,60,249,37,82,72,80,247,154,169,191,31]	t	CTVc5vyVWbvHXhJHHEYCbff2PQ8jR7zatSorPSrQpump
129	2026-05-13 12:26:35.070009+00	[102,229,242,166,0,234,103,44,245,176,105,34,4,48,139,205,107,138,36,112,231,195,225,188,136,198,79,210,185,176,54,234,117,171,193,182,215,222,118,71,164,30,0,158,191,235,51,198,75,241,138,20,215,233,247,208,224,251,96,38,87,111,187,255]	t	8vLbyw5R49MGfemJbqHv3DDpwry4Uh7ksEukr8Tkpump
130	2026-05-13 12:26:35.083687+00	[140,96,21,155,180,170,7,69,2,246,18,24,34,120,249,6,111,231,135,80,241,124,22,44,131,150,166,94,138,158,187,21,141,155,230,32,221,32,120,108,154,28,169,166,42,54,114,110,135,121,229,47,140,119,5,197,239,175,44,118,62,196,96,127]	t	AXnN4nx5H52ncsZxG7RSPs8sp8LPQ5R2XaqCzLBcpump
131	2026-05-13 12:26:35.095766+00	[11,93,65,148,9,217,97,170,111,69,176,101,166,170,72,108,171,97,68,135,16,37,163,171,119,96,125,198,134,61,69,194,197,252,162,120,211,223,51,85,196,43,52,77,248,240,172,69,151,113,110,148,229,2,204,45,107,203,58,14,209,130,217,79]	t	EKrkNhXdFVT8zqHevnP3zd5F6mJAaiKJSoF1GNNTpump
132	2026-05-13 12:26:35.105893+00	[31,185,127,211,174,97,241,68,48,246,146,156,242,184,141,22,86,13,76,252,143,181,178,155,252,198,51,89,43,26,126,174,144,227,102,87,157,147,110,180,123,177,124,31,26,253,197,57,60,235,149,220,210,125,19,114,226,54,235,84,250,70,99,143]	t	AkapgBHX1kAUAkNasANdSft6dGynUa7vv7jcW6jVpump
133	2026-05-13 12:26:35.116709+00	[63,201,175,245,233,181,183,143,208,254,80,229,168,103,129,93,201,86,88,88,174,254,38,179,169,196,200,74,9,128,78,24,191,100,83,194,5,6,83,84,70,151,253,51,228,81,197,148,113,46,180,106,236,22,235,32,29,124,10,123,179,37,90,63]	t	Dt7bosBz9fLQJrpdYx9ovviJu9oZtPy5jbvg2cMUpump
134	2026-05-13 12:26:35.127258+00	[207,5,14,127,159,85,252,26,59,108,57,171,218,247,174,31,63,213,235,164,34,167,103,234,229,88,152,164,239,253,152,181,110,86,169,175,192,184,63,80,155,132,230,130,6,244,243,46,63,44,24,72,239,218,150,195,13,159,227,210,152,177,55,255]	t	8RiVXST6t4YKVvfqL8y3L573aDuD12FyY1i9mGB4pump
135	2026-05-13 12:26:35.13823+00	[209,228,150,181,33,227,88,49,160,18,231,74,121,198,23,22,246,37,23,2,215,94,30,95,37,151,241,143,116,12,18,108,195,15,37,40,124,20,16,210,120,28,99,174,176,35,205,159,202,123,79,18,198,139,176,237,51,115,215,26,179,91,7,111]	t	E8RtwVkFkaHQJZScUwxQ1bHGsCdDQxY2AWJEf9z1pump
136	2026-05-13 12:26:35.149002+00	[118,47,172,12,15,206,66,209,56,187,170,208,194,172,206,121,160,6,147,9,228,68,189,23,199,83,241,145,181,75,190,92,34,69,171,113,202,3,223,245,19,104,106,42,84,219,208,202,38,87,184,86,248,244,2,22,49,24,7,29,164,144,90,143]	t	3JnUisYvVV9b4ABL6oCUBQ9DiCFV8u4BGR1dgimhpump
137	2026-05-13 12:26:35.159944+00	[192,74,70,78,17,89,63,94,238,186,6,175,144,153,240,104,107,79,250,237,135,190,136,47,171,177,34,80,167,82,144,104,119,143,147,69,217,237,101,105,215,81,220,157,13,137,121,192,45,63,219,127,62,6,162,12,97,169,66,189,118,73,67,191]	t	93iVhKKa6UuRJPHCVKzKaM9k9DHSmAX3zwEqByFcpump
138	2026-05-13 12:26:35.170317+00	[41,228,155,55,189,99,222,72,229,215,232,245,36,108,173,113,122,250,83,46,132,85,6,74,237,27,194,88,121,205,210,163,89,156,121,245,49,92,254,95,137,77,249,221,234,108,239,144,24,160,139,21,164,31,131,47,185,194,119,129,15,65,96,127]	t	72og54MJ7sKqRUbDuVycqj3VpFA2XQmR4w4GhBGEpump
139	2026-05-13 12:26:35.18024+00	[111,78,6,80,220,69,121,0,14,206,153,199,185,4,166,178,79,31,46,50,151,247,46,58,223,8,222,175,59,33,201,166,242,207,61,173,213,165,209,206,43,183,137,4,156,180,21,19,175,152,132,112,227,71,46,204,48,255,39,76,116,161,69,111]	t	HLpwyNKjj3pYmp75peqz14LHT1kpkkcVJS6PLKdbpump
140	2026-05-13 12:26:35.192213+00	[102,37,45,148,239,164,6,83,220,137,109,160,164,165,8,147,35,153,93,208,80,167,241,233,218,18,4,143,12,178,138,176,137,20,103,92,248,146,169,159,138,78,152,203,187,210,89,90,161,176,241,104,82,106,193,69,35,250,241,134,46,94,246,47]	t	AE6uBsgxTogrpdoJPaTQvgmzynVwtj8tSwCSyUBPpump
141	2026-05-13 12:26:35.203781+00	[232,206,55,223,255,254,95,142,199,202,179,72,116,208,186,253,25,49,46,98,24,98,193,28,109,64,9,78,104,187,248,30,216,82,238,233,130,100,48,163,77,132,249,35,167,64,121,11,172,141,172,20,222,17,252,178,2,84,121,59,151,197,82,111]	t	FZSQju4AGJJcWvz5hGyqe1gtWdoGiVor3HCi5v6upump
142	2026-05-13 12:26:35.21469+00	[76,214,179,61,248,160,251,217,61,165,24,164,145,246,153,180,67,58,99,190,222,91,175,181,127,221,186,3,118,34,90,27,116,69,96,145,170,182,211,7,244,184,124,13,83,57,125,74,183,171,238,244,245,115,59,229,117,162,136,194,216,82,135,127]	t	8psejJsTtkDdHtDuqXxRJhJNzwRCzS5oWE4gAbmcpump
143	2026-05-13 12:26:35.224011+00	[198,83,233,125,255,44,197,63,222,207,75,29,214,162,119,247,32,94,26,234,194,66,13,102,47,222,175,212,201,100,97,61,95,83,162,145,94,20,210,146,191,20,233,161,43,8,45,74,36,40,32,230,245,182,229,135,215,179,81,72,1,17,77,127]	t	7R7hWs3y77aho2bxLbvtWiJQn1byMuRpC3tkgscWpump
144	2026-05-13 12:26:35.23608+00	[199,222,35,18,156,58,57,149,126,194,126,117,132,24,105,173,9,87,213,201,38,186,176,148,85,152,139,147,217,52,255,245,38,15,2,167,252,82,225,221,84,152,196,130,209,26,93,127,28,23,113,73,30,42,32,220,97,62,124,32,72,116,11,207]	t	3ZZmXmd3G3MqG3NkP1g2k3sFRA4fvHuJBiaWZ89Mpump
145	2026-05-13 12:26:35.246637+00	[37,176,220,193,215,11,36,193,172,31,130,172,137,249,144,5,34,215,157,187,228,20,78,204,167,67,181,106,242,25,71,177,237,62,11,124,128,175,85,205,48,169,82,104,169,244,194,37,199,79,232,75,179,228,200,99,243,196,157,157,220,205,1,63]	t	Gy6VqTz9ZsjyLG3NhjKvCnQVaoEDY3E4DZA61bRGpump
146	2026-05-13 12:26:35.258914+00	[193,97,184,87,60,96,55,154,167,134,160,75,61,198,203,25,82,255,105,83,18,21,245,166,1,110,217,69,217,180,101,1,224,119,120,92,226,13,195,172,28,174,52,87,107,175,97,24,60,15,1,152,151,27,5,197,86,33,165,41,59,28,251,15]	t	G7Dz6FfX3rNj8KGFxrjq9rq5bhR3LUJmpmRX3HUwpump
147	2026-05-14 17:24:16.812068+00	[167,172,212,169,204,181,91,79,255,239,69,200,131,87,103,66,150,161,169,237,16,96,139,203,202,38,159,137,41,232,185,100,185,183,84,146,110,75,113,166,198,91,226,20,170,75,74,56,71,159,212,246,144,16,10,119,138,152,110,66,38,159,241,111]	t	DVxZcs4ocY1everNTKNNs18SyDg9XZKSPxKjs1s7pump
148	2026-05-14 17:24:16.856184+00	[17,26,18,59,137,62,27,154,29,69,16,50,135,120,189,19,160,227,9,86,62,91,54,196,202,218,0,141,219,11,221,229,130,206,153,136,192,120,16,165,73,225,24,18,180,89,23,176,247,215,195,191,252,213,178,201,29,76,67,123,39,174,50,143]	t	9ocigGRS7TbYES81j7H9VaxFSnTFtNAUvvSgkgdHpump
149	2026-05-14 17:24:16.890159+00	[173,69,57,19,233,94,137,90,170,140,59,124,187,73,37,22,126,14,131,29,241,238,252,61,0,115,42,69,109,242,243,152,180,174,222,82,10,245,96,235,138,1,183,36,186,153,157,99,155,176,93,111,76,72,128,246,46,142,91,237,170,236,189,255]	t	DAK3L16VDSi47ZdYaQ8uMYeee2h5EM6ogB68YrXkpump
150	2026-05-14 17:24:16.927313+00	[233,44,39,227,62,220,205,19,183,229,146,88,181,149,2,88,133,199,237,237,247,174,180,145,48,199,191,192,215,27,246,188,17,77,55,47,115,90,28,229,135,54,83,58,85,128,70,144,199,85,227,132,62,39,37,122,9,181,197,130,25,104,47,63]	t	2AYDoSWxwcwFhtA5ADQ1pgj4LtpoaGCquv29ZkfGpump
151	2026-05-14 17:24:16.948627+00	[142,69,193,76,13,177,200,122,139,31,173,65,116,46,141,169,168,187,57,254,243,185,237,64,227,197,102,40,238,165,76,74,244,243,244,55,8,174,85,154,43,7,194,222,18,142,86,181,219,169,184,158,129,230,106,42,70,204,174,18,67,156,15,47]	t	HVCEUiWsQnRTZcjR6uECxpdvetMvGPWWfi1UVx9Bpump
152	2026-05-14 17:24:16.963803+00	[18,92,192,230,0,238,195,249,114,201,120,96,164,244,17,247,90,160,120,85,73,190,162,1,71,235,34,250,3,98,210,32,38,101,73,9,213,46,244,123,91,38,186,240,87,50,78,240,81,96,132,144,171,238,122,109,182,222,105,102,30,223,211,175]	t	3at53ehVVdS1aMwLcK74AJ3zXbLiEbPfh97ZvRdXpump
153	2026-05-14 17:24:16.982555+00	[6,112,101,155,56,63,173,138,179,97,236,139,169,207,235,180,25,217,124,24,21,3,228,186,62,29,237,55,16,214,110,196,189,172,129,8,9,25,164,69,182,14,66,76,158,108,149,19,46,196,134,103,230,77,141,152,101,19,249,87,52,222,186,223]	t	DmQcs1aTdi6uQshjLE4i95fvyCUZs5TTABY1HvFrpump
154	2026-05-14 17:24:17.000966+00	[216,185,205,135,120,199,12,184,209,49,97,119,195,221,16,159,141,75,225,252,223,103,146,33,35,27,226,210,115,155,236,117,119,3,169,39,130,237,168,212,106,212,43,235,65,155,41,209,128,201,101,105,62,156,82,182,220,163,18,250,79,255,234,223]	t	91akiCmzb8McCvHTFfLsdM1V4op4swC1FKGXC7VApump
155	2026-05-14 17:24:17.020305+00	[207,245,85,149,207,144,113,197,206,103,194,76,143,202,163,253,111,23,13,12,157,194,128,31,47,140,144,176,8,105,147,175,194,132,89,112,76,130,126,143,138,106,1,128,8,72,166,154,250,36,183,83,191,44,20,97,180,88,189,84,114,191,71,175]	t	E6K9Los4FJKjnyuQMZR7wSsepDuNugKeY1epSdQqpump
156	2026-05-14 17:24:17.030828+00	[33,142,172,24,238,173,237,206,31,232,54,170,210,166,181,120,32,154,15,202,25,81,196,71,44,101,173,114,223,241,150,9,123,165,70,32,12,206,35,117,206,116,25,134,74,48,198,109,83,18,61,137,146,60,45,59,78,171,77,250,155,240,45,15]	t	9KfKKmPZfW9BEL8eP4KhCv7tgmEXoQsXb4tCvC27pump
157	2026-05-14 17:24:17.045282+00	[70,206,228,220,146,34,75,11,157,102,8,47,244,151,142,104,247,242,51,242,165,69,108,236,60,27,111,68,223,48,24,184,208,53,163,99,5,26,2,254,176,45,217,4,33,148,231,33,202,134,150,180,185,121,196,36,112,87,149,53,194,67,162,159]	t	F1mEsBondS1PLFhJ8WwvJ7Gufn4M5BiT5ts5n4D2pump
158	2026-05-14 17:24:17.057113+00	[35,187,231,78,52,92,190,17,178,111,7,45,53,145,176,40,3,163,59,188,49,55,97,134,194,248,112,2,23,148,18,92,246,28,208,37,239,0,59,154,49,69,144,28,62,212,125,229,189,196,94,152,110,121,187,90,203,213,208,65,233,89,190,207]	t	HZin1jxa8mqWVRYZg1FFLQAeenA2B8ZsMqAMhnwHpump
159	2026-05-14 17:24:17.073379+00	[96,135,198,16,173,203,118,175,227,133,122,100,5,65,137,143,242,251,98,148,77,73,208,236,123,195,195,60,60,159,25,89,62,250,220,43,207,247,192,236,218,142,253,249,168,182,245,205,245,73,158,113,26,57,74,32,224,104,91,29,197,213,144,127]	t	5Er957tU6gs4HXnnEhkdsjTqkZShtWsnouCkhRtnpump
160	2026-05-14 17:24:17.089698+00	[200,152,65,228,173,255,90,228,56,13,126,84,11,127,120,19,237,203,119,73,59,66,38,72,181,87,110,101,85,180,77,79,61,99,101,72,163,216,126,88,207,109,50,121,84,179,34,119,239,182,5,82,31,21,32,169,213,140,173,159,238,87,180,95]	t	58dmz2DJGaaNLtYDbWFUaXqR66ds35XYrZ892CHNpump
161	2026-05-14 17:24:17.113988+00	[98,28,194,100,234,138,47,54,58,73,42,116,170,87,121,237,236,122,7,32,8,106,35,16,163,200,211,122,229,143,80,147,54,172,64,49,5,96,30,50,194,2,160,112,28,4,119,108,35,222,3,144,54,167,185,114,34,118,107,218,33,129,168,159]	t	4gRMbbyPwF5kEq644DTGVne4gxJFFHxv8khDD28tpump
162	2026-05-14 17:24:17.132783+00	[32,181,246,150,3,49,200,30,227,53,34,246,73,192,12,229,41,234,59,219,83,174,125,212,45,57,55,181,151,61,216,68,219,77,243,136,210,9,100,155,83,248,43,119,1,216,135,158,208,16,207,139,119,109,90,164,32,200,216,28,219,22,188,255]	t	Fm5E8QiGqaE6hfskDYaftT8AHJJUCAR41sUaii3cpump
163	2026-05-14 17:24:17.15081+00	[60,182,103,230,214,151,92,144,74,31,209,178,117,105,34,52,162,93,147,206,212,143,169,140,203,87,66,113,31,7,60,65,152,242,157,36,177,148,118,230,134,44,16,11,230,155,223,4,231,203,30,162,77,200,9,127,36,92,49,200,54,26,57,207]	t	BJ3YG6f4NK1PjPiGZeRTTBMcdL63htzR1L9Q49fDpump
164	2026-05-14 17:24:17.182156+00	[231,221,117,107,0,62,135,214,112,111,17,106,173,131,244,175,202,104,6,150,52,68,66,159,202,191,71,248,11,28,1,220,76,25,127,114,198,154,74,185,120,174,231,212,191,25,68,99,76,107,142,161,24,90,246,182,185,109,8,70,80,166,80,127]	t	684Y4GNFD4TtiTmo3eyXLChvJXskdQPWXdRveTKQpump
165	2026-05-14 17:24:17.199321+00	[38,223,234,175,47,241,212,12,102,86,139,228,77,169,97,232,141,181,212,157,72,74,231,64,245,215,73,121,251,111,222,69,35,17,244,230,92,135,244,209,67,247,106,37,227,156,25,47,133,251,117,215,4,55,27,211,203,192,31,83,17,74,156,239]	t	3Mu9iq3Hzbw9kftjSRyJGz6PLgrWwZDrboogCCvDpump
166	2026-05-14 17:24:17.223241+00	[255,137,176,192,82,58,185,111,102,246,47,182,207,31,171,42,97,57,84,170,119,231,165,123,177,176,67,217,244,144,234,139,81,232,186,165,109,15,0,246,42,120,20,121,171,189,76,112,28,221,75,190,58,7,197,158,119,185,254,13,186,203,118,143]	t	6WjrKRGTWj8Y1LTEcbQMidGWWCiEEEXHqqzTcSKmpump
167	2026-05-14 17:24:17.242913+00	[50,147,45,119,47,28,42,30,0,15,142,53,232,253,82,147,113,249,46,28,239,139,160,118,130,101,53,191,131,145,94,22,185,221,204,193,95,202,185,213,142,116,55,42,72,215,9,117,237,135,65,5,23,219,203,31,151,98,249,113,96,10,56,255]	t	DWYavrqtVSF68rwW5sryrQm7GXo1kNXHiyb7v5Nzpump
168	2026-05-14 17:24:17.258513+00	[119,81,249,87,173,25,244,134,228,246,140,46,68,99,96,199,177,91,92,243,183,59,56,129,15,166,29,147,141,10,226,59,187,145,249,77,67,69,178,59,68,22,192,135,229,144,236,8,251,238,159,204,231,206,43,182,68,123,107,21,17,255,1,63]	t	DdCLh1rX8MLUbq2arLK3MbJTSBQbkG9u4Ksu4pCepump
169	2026-05-14 17:24:17.282628+00	[37,44,230,199,199,220,142,70,106,44,41,116,28,57,122,44,143,39,148,25,20,182,102,119,169,63,49,70,95,50,151,84,100,108,160,157,201,211,22,138,188,53,60,53,165,32,141,45,113,234,176,157,107,167,73,67,62,180,75,166,56,104,251,95]	t	7m1qk8KdxciWYcjsT3kH9m1UQwtHBa9fyq6D4Mzgpump
170	2026-05-14 17:24:17.300349+00	[23,200,96,224,11,28,235,230,37,86,166,190,46,163,183,197,230,182,221,225,218,198,243,92,161,145,6,121,176,239,177,91,153,152,231,92,91,87,238,133,153,165,11,42,11,102,77,236,71,84,170,216,239,14,177,99,140,135,13,126,69,87,162,175]	t	BLacBeEVNCHxNFHEM9deTQqdBks9Z28DL6ZxoEVKpump
171	2026-05-14 17:24:17.315772+00	[112,135,60,235,89,126,243,55,75,60,104,128,194,103,155,207,22,137,98,118,26,254,136,145,239,92,88,80,165,188,253,168,1,248,226,206,217,76,218,85,174,9,186,53,125,44,141,0,97,236,182,16,116,139,76,108,150,115,77,93,150,139,252,191]	t	8hXNm9kYWqSnaygEAbjtzNnasnonnV1wNzgpSFQpump
172	2026-05-14 17:24:17.32835+00	[58,171,240,203,144,221,215,251,66,215,71,229,99,86,171,245,78,229,177,84,92,156,10,123,213,8,122,105,64,4,138,42,22,43,229,109,31,32,9,6,191,29,243,73,232,205,96,51,72,247,26,135,94,132,95,145,21,96,40,249,217,167,32,127]	t	2VYnuAeSge496KHrayfPaQNiLpe7xSXFCZC8bonapump
176	2026-05-14 17:24:17.388422+00	[78,221,200,217,213,46,239,2,143,83,160,164,110,16,118,104,29,117,162,135,112,128,164,220,102,226,57,158,4,21,100,115,103,254,17,44,11,41,220,209,98,70,161,116,108,128,65,172,118,250,21,171,178,204,182,223,255,119,200,63,173,15,56,255]	t	7zwh5oH9Ej2KBqZzBGU7dhUDzGubyQbXqnjv4bgEpump
180	2026-05-14 17:24:17.478832+00	[4,68,82,190,32,40,194,92,150,79,190,176,115,137,60,178,255,46,189,69,110,55,237,134,227,237,54,252,191,163,170,66,141,78,118,161,125,73,156,42,181,191,166,89,160,95,46,132,17,105,167,198,212,214,81,41,47,8,111,129,98,153,210,79]	t	AWbsyLFnRE87FwQrGTMC1bB5Bsn8wXCaBjFVhkF1pump
184	2026-05-14 17:24:17.548807+00	[253,170,193,80,21,17,114,0,187,104,0,146,170,1,190,242,174,106,154,189,161,159,224,32,151,228,85,95,233,29,140,48,245,82,156,191,181,122,115,62,195,189,29,93,221,11,105,173,72,45,168,160,216,76,210,233,164,229,53,28,171,245,52,223]	t	HWdx2PYA6yZ8s3RHVQRbRTYeuJCykfCWttYfVTrppump
188	2026-05-14 17:24:17.609911+00	[61,63,51,229,53,235,100,236,71,178,157,57,194,174,194,159,42,227,155,177,39,247,85,242,144,6,233,159,205,1,105,9,240,75,142,38,29,85,160,100,135,47,175,81,135,108,165,213,181,33,212,218,110,236,0,106,8,102,111,134,32,21,84,95]	t	HB1foGRwrCCNwBVH5SwdJZbDJ2ULWoqyCdzej1DJpump
192	2026-05-14 17:24:17.664953+00	[96,217,162,44,127,235,31,214,184,186,169,2,103,12,128,90,58,54,78,224,78,82,87,248,127,181,79,237,218,234,152,51,178,102,156,9,146,123,246,228,28,82,23,4,213,144,203,94,85,36,58,246,147,133,199,240,247,204,149,52,196,188,140,63]	t	D1QKUiBztjqUcJkqjTQYai25WXwDB3ojpphCGDNnpump
196	2026-05-14 17:24:17.738477+00	[208,35,60,103,68,35,211,200,15,135,55,137,59,215,128,71,79,161,180,255,54,89,231,138,70,118,27,251,83,142,51,6,105,35,29,221,41,23,0,56,138,132,255,65,58,9,218,250,174,160,45,26,170,201,75,233,147,196,157,114,47,162,89,143]	t	85QsCvZpUfUPeVepYGyCUvK9E54bxsw3UcFcBCQjpump
200	2026-05-14 17:24:17.799982+00	[228,35,164,87,4,64,135,186,42,120,218,230,172,175,230,42,79,102,11,213,51,110,63,12,23,178,204,192,147,249,48,115,43,145,232,100,104,228,238,68,13,198,238,134,188,103,109,157,146,155,47,42,247,111,54,67,232,193,170,4,56,16,250,159]	t	3w5aDBPBre3oFTtUz7m9cDWYGfAT2SCNVYbWGQsvpump
204	2026-05-14 17:24:17.851852+00	[38,215,201,29,54,239,91,66,200,224,122,240,147,204,215,206,7,107,166,134,108,156,168,116,138,209,122,141,252,15,239,81,229,230,227,247,248,107,21,69,5,6,249,160,32,177,75,184,69,37,134,90,119,247,208,86,83,124,111,35,12,108,65,15]	t	GUSZggAL9nWCV42NjqG8nQ4Ep89oa685cwQED3Uopump
208	2026-05-14 17:24:17.926925+00	[214,120,93,131,131,48,179,251,24,0,239,44,113,255,71,13,75,63,28,27,189,246,180,108,103,249,215,179,4,158,149,162,75,130,213,194,111,144,112,134,188,58,194,57,41,242,182,185,193,34,247,187,51,176,107,126,49,166,217,22,150,136,244,175]	t	65mHjQWESeHW7XeP9TBgF8kQGZno7NUe7YBLkP4Hpump
212	2026-05-14 17:24:18.013191+00	[252,93,237,63,250,30,137,195,221,58,98,232,252,152,112,53,202,68,208,13,215,70,72,10,118,213,198,205,11,41,213,234,75,143,169,246,49,21,105,168,247,141,183,86,146,38,220,251,95,184,109,149,133,120,57,206,53,193,24,134,49,191,153,95]	t	65xdoCun8PJg7J1Zf4FgsDdbQNzYheLkrXwC6SsApump
216	2026-05-14 17:24:18.065261+00	[218,76,99,195,133,172,180,221,90,59,101,123,96,174,15,245,214,64,247,184,24,144,121,152,9,150,217,71,170,253,43,187,185,74,116,176,234,16,66,202,50,216,46,187,125,161,165,142,217,141,12,178,19,107,197,178,239,222,146,113,250,98,254,223]	t	DUJGr2X35TKLq5ASBeTEFYfzofUxt1rkMsyhRA56pump
220	2026-05-14 17:24:18.122651+00	[238,147,56,0,190,78,42,151,122,86,183,122,246,161,44,135,75,41,43,171,129,181,134,221,2,63,104,17,222,142,8,238,194,66,9,225,181,224,38,147,229,191,71,142,27,220,132,142,62,235,87,195,196,67,22,144,228,12,134,239,18,159,223,95]	t	E5JVu5KswmFxjVoD2Tg4rqKZvDS1D1UhhnvBaM7epump
224	2026-05-14 17:24:18.175876+00	[132,39,113,217,8,112,248,123,139,159,87,220,208,45,159,247,66,50,205,24,216,84,146,13,211,36,29,230,59,229,42,126,108,219,103,200,239,249,98,53,119,6,229,245,92,218,128,251,247,107,242,113,18,59,31,182,58,91,141,109,2,220,89,79]	t	8Kw5L1GEWQqk8UQ2TPUWvKeYPdUnRtt2u3WWDSPRpump
228	2026-05-14 17:24:18.244136+00	[40,139,117,252,227,78,12,77,96,126,106,17,209,86,195,185,190,97,152,52,190,39,235,28,249,103,54,208,129,169,158,117,153,136,233,144,165,196,83,163,43,55,99,231,0,100,231,65,86,112,231,120,31,80,28,78,105,194,6,243,53,97,255,191]	t	BLLTu3MaUaM4476pedNMJQ2uNGaPpU1UL33JnPd8pump
232	2026-05-14 17:24:18.291797+00	[151,106,135,78,243,93,150,122,148,220,227,22,22,205,250,244,14,37,118,194,60,144,175,147,231,17,95,237,64,175,168,224,213,69,20,132,69,159,10,198,129,46,88,181,230,66,103,81,38,79,194,137,237,13,219,234,7,143,211,8,109,109,73,159]	t	FMWwCVpFpFoKszDJdFDDPDMtgnt3Ev42ZFSckA7vpump
236	2026-05-14 17:24:18.351814+00	[240,66,169,32,10,15,111,164,141,118,168,217,150,150,99,85,85,34,44,235,34,218,121,75,221,248,99,66,73,219,187,195,102,159,33,198,193,170,105,148,138,142,250,219,234,19,40,51,67,96,223,42,167,9,109,15,122,111,26,90,78,167,19,15]	t	7ubKh6pB5KMuKTUaU5mnjiKuTK6WZZ3Cx673Mv3Vpump
240	2026-05-14 17:24:18.415235+00	[150,154,179,228,18,149,122,134,24,237,176,212,221,161,206,23,83,116,49,159,152,53,39,134,87,117,44,67,0,49,100,226,3,196,127,120,175,67,229,248,225,208,116,210,31,42,209,29,90,59,239,220,218,181,96,98,181,187,81,34,55,61,160,47]	t	Fi1Q67zRMRYpVNjRPGd1mp3WUUmd7A3SJ1xw2Ympump
244	2026-05-14 17:24:18.468858+00	[125,248,217,223,250,111,167,56,194,84,79,36,219,107,22,8,22,192,127,173,186,248,33,113,63,142,252,127,255,13,45,250,176,22,49,115,167,110,151,142,55,156,63,253,75,107,59,202,165,159,240,181,127,231,18,236,34,244,189,104,112,229,15,63]	t	CrNPBvqNG4r8z3cTJvuFX2NYVY2BsyZXgM8QjL7ppump
173	2026-05-14 17:24:17.342334+00	[9,90,190,194,149,66,240,212,230,145,163,225,24,149,143,196,6,157,15,247,149,201,3,223,75,34,243,136,102,1,68,222,125,254,201,173,113,129,21,63,65,120,73,46,12,244,97,99,197,95,229,139,219,57,51,16,144,5,21,210,253,108,226,143]	t	9UqJGx3jAL5SGkXVt2Dzf4yuERa2o9f8u7vPSAEXpump
177	2026-05-14 17:24:17.408139+00	[148,141,242,133,183,171,118,112,242,17,239,114,29,55,18,107,133,239,112,193,94,144,68,14,151,39,89,102,24,57,38,103,235,67,24,125,242,86,246,42,162,172,53,46,164,175,252,203,243,68,54,126,217,161,209,184,130,244,73,135,226,214,92,15]	t	GqN9dKG19fxe6pdtHp3C9RdJGQ3dbu769rkHpKs1pump
181	2026-05-14 17:24:17.497589+00	[172,181,3,143,201,31,193,78,255,114,157,136,227,134,119,169,84,7,84,98,77,221,31,223,112,106,4,16,63,122,159,96,152,70,178,120,239,168,105,215,22,235,136,143,168,228,209,85,45,62,80,102,231,164,103,68,118,189,14,38,151,76,214,239]	t	BFRVi8R3Tyi4KqVQLZhJpVa9Zbp2YCzcp7GgCPP7pump
185	2026-05-14 17:24:17.567228+00	[243,132,227,172,133,34,232,28,251,30,73,134,34,163,217,136,157,62,95,177,86,230,62,103,150,31,228,33,167,9,221,134,108,2,157,240,84,59,34,201,167,167,190,131,72,121,54,231,201,81,21,57,100,195,187,59,49,1,170,127,130,199,68,15]	t	8GdM4GrRnM4vVm4PgsVs41Ec1BsqrqaCGwvv2Fhupump
189	2026-05-14 17:24:17.623609+00	[61,154,251,84,47,62,136,105,132,14,253,89,229,230,199,142,99,174,52,154,136,213,32,156,37,201,221,41,153,162,141,169,86,19,11,107,80,105,109,199,27,215,237,112,154,60,4,88,94,5,105,111,31,209,94,146,218,189,127,182,50,150,238,159]	t	6nzuVwMxPTfiY4CCrX2vtKdyt8oX1RZfKUB1xkVrpump
193	2026-05-14 17:24:17.690019+00	[232,68,61,192,100,187,101,9,31,8,26,44,200,76,176,236,195,168,211,139,34,110,75,84,189,56,154,243,142,135,40,126,11,55,196,167,7,219,90,43,211,220,169,75,209,156,204,140,109,160,140,219,126,101,103,249,214,249,116,38,1,24,59,31]	t	knomVqK3xf2SERRaLyJzmb3CbU4GdW6J9jyNRxQpump
197	2026-05-14 17:24:17.754543+00	[152,132,79,202,200,11,6,247,62,110,26,207,90,254,185,158,208,169,1,19,67,41,248,210,220,24,218,85,205,81,150,111,248,161,183,148,85,161,30,130,129,57,153,4,23,124,196,51,237,204,190,113,63,36,37,24,253,6,107,79,35,83,104,223]	t	HjZ8geJLDjA5SkAg1oExXqbN95Tb227UHggB6TZapump
201	2026-05-14 17:24:17.812229+00	[39,30,147,123,24,87,160,78,102,115,35,110,227,129,113,236,75,94,37,185,33,16,106,213,107,148,22,246,213,25,16,187,111,133,93,225,223,184,132,63,85,9,225,12,104,145,199,33,58,47,34,240,70,93,91,154,132,237,65,156,193,162,225,143]	t	8WLCsUwtG4sBrA3oW2T6h3ikh7vckrYhWGJ9MLEFpump
205	2026-05-14 17:24:17.864801+00	[190,173,169,132,7,234,6,142,48,190,87,181,20,34,54,140,112,237,59,36,142,10,15,137,186,153,139,160,72,122,120,244,190,208,254,97,197,174,17,89,165,29,230,247,74,69,157,150,93,92,61,143,166,28,8,204,58,115,240,97,241,64,166,31]	t	DqsJGGwsnULhBzrVKui6yP3Nzq9YMw3yG6nayS9apump
209	2026-05-14 17:24:17.952614+00	[158,56,101,60,210,216,42,195,13,19,201,47,251,254,190,229,105,9,89,7,242,100,31,252,82,107,82,222,67,209,220,99,247,66,140,140,54,30,51,74,235,191,46,27,144,100,94,105,210,17,169,134,43,26,197,151,233,216,254,112,20,109,75,175]	t	HeCZLsr5Ja7ud6DQ9pDT7Zw95HZLfg6UbTCt39F3pump
213	2026-05-14 17:24:18.02778+00	[171,160,146,82,32,93,18,250,252,10,26,237,92,212,231,13,196,77,19,110,0,147,94,240,75,21,52,216,92,183,6,90,236,145,91,86,236,218,173,25,79,20,20,130,25,34,215,208,167,0,105,196,137,144,14,60,221,70,176,93,7,169,57,239]	t	GvTmiWBbromozYRnoVSumbdYmcqZm8ijE8AEhtSDpump
217	2026-05-14 17:24:18.079609+00	[184,213,173,196,23,67,195,146,226,207,223,156,104,112,22,182,134,76,240,95,10,224,21,134,195,82,33,172,107,112,83,203,179,184,85,166,7,27,63,114,238,215,218,193,170,107,54,53,1,195,191,206,138,51,201,115,126,91,62,213,125,75,166,191]	t	D6Z1FYQfUeUZLe2mNsx8MRFkRbdE4MZhQbw8nYx6pump
221	2026-05-14 17:24:18.133707+00	[252,251,79,86,63,30,247,110,176,236,80,30,119,139,185,9,53,22,199,111,177,241,210,2,232,26,61,84,27,120,13,32,172,50,192,225,242,222,60,239,151,150,34,133,144,154,212,215,243,107,71,30,255,159,141,220,11,227,213,175,144,104,106,63]	t	CbC1cjMiaSVG67SmXyrsXtGY9BVYUdgp3aE1rVkJpump
225	2026-05-14 17:24:18.190521+00	[190,24,129,230,58,149,91,28,20,214,91,240,212,97,252,148,192,5,164,232,55,166,61,46,247,219,52,126,171,239,164,79,78,211,5,235,4,162,108,132,86,60,167,24,183,135,248,247,213,134,237,204,147,199,144,203,154,167,252,228,19,21,192,15]	t	6JhRxfX9BfLLqDZU2MR3osYB1rphUjYZtTFuLagbpump
229	2026-05-14 17:24:18.255734+00	[132,3,191,181,99,191,172,27,8,228,217,163,115,194,232,81,30,116,223,137,90,231,22,138,23,16,83,138,205,31,211,81,131,124,246,222,129,35,89,114,91,135,184,49,36,174,84,164,243,101,208,212,198,201,236,230,86,57,162,27,163,169,9,63]	t	9rGvo6bt65m6Miu35E8ZMPVGhuUxYCqD6GQZyo4rpump
233	2026-05-14 17:24:18.312906+00	[209,145,16,197,239,44,46,73,249,90,232,211,91,22,112,139,89,88,107,77,133,105,109,80,92,242,143,3,210,97,161,21,109,201,217,161,102,5,185,190,172,12,164,121,50,114,234,244,81,150,234,159,97,232,246,243,72,200,30,141,46,109,29,47]	t	8PZxU5P41HvTA3CFPUKSwBcSVoLvADLtq66ZRj4Hpump
237	2026-05-14 17:24:18.369085+00	[99,53,238,94,252,152,173,249,96,197,243,193,125,123,85,38,169,240,4,191,209,44,5,88,238,213,88,115,85,137,141,26,184,141,52,81,200,248,236,138,127,61,124,216,13,110,236,51,195,130,154,222,71,206,6,190,243,145,230,167,169,30,125,239]	t	DRQu6icSMtC5frLReyhz81uC88SjtHi7wMJLf6Gypump
241	2026-05-14 17:24:18.428183+00	[78,36,211,152,57,221,114,236,83,212,182,221,80,41,109,125,173,190,248,124,31,130,71,108,147,3,23,8,130,3,193,102,203,134,69,2,250,179,182,71,14,96,149,82,151,40,202,204,209,110,141,70,190,41,251,27,91,41,200,8,7,5,100,207]	t	EhUWf9YFYoVfr2GtGfUhYYdSzT7w8vZMxoLoP89dpump
245	2026-05-14 17:24:18.502043+00	[229,92,1,124,140,95,91,81,237,94,205,241,199,55,78,246,10,130,204,52,224,66,181,246,192,182,21,97,82,162,156,55,202,143,231,236,39,31,16,132,177,32,206,180,130,59,156,122,193,142,15,27,0,33,51,120,179,84,241,9,200,180,157,255]	t	EdidKC2e7gcxE9nNzirxPiqMBDbEZ5LD6viTUSxJpump
174	2026-05-14 17:24:17.353345+00	[8,220,145,3,95,35,6,56,148,242,52,39,52,124,225,99,138,254,152,252,253,82,42,195,244,162,157,129,69,23,102,174,5,51,152,24,120,253,33,113,211,107,199,169,226,25,37,236,192,199,221,2,144,77,136,80,161,135,128,60,231,27,163,143]	t	MJfn9YGcEW9Ayb75wStHmja9jLif2ep8fQPP5j9pump
178	2026-05-14 17:24:17.439655+00	[51,75,122,219,125,156,193,39,150,181,198,233,47,56,21,242,88,45,192,99,171,22,94,141,211,232,230,75,176,88,48,21,0,80,57,232,201,52,51,85,35,64,127,232,111,186,26,70,24,79,81,221,61,88,195,179,66,157,174,25,191,101,219,63]	t	12DxF6QmvqiKMJqGDVsQm1vzgY6jPNyHrbRTryavpump
182	2026-05-14 17:24:17.511638+00	[185,136,97,223,131,155,21,132,60,131,142,151,235,78,252,111,31,209,2,102,54,74,124,182,164,92,62,90,170,153,86,224,166,54,58,75,234,83,172,199,0,102,74,157,92,147,7,73,164,91,221,243,77,177,5,74,54,147,163,198,206,255,211,239]	t	CBpdxCnCZfVuSHGMtBZwu5xB8ZLZ8i6emRPDg1XFpump
186	2026-05-14 17:24:17.582012+00	[65,72,67,2,232,24,242,194,7,227,87,28,142,81,121,21,85,131,186,229,184,228,76,43,193,4,106,20,104,202,238,178,12,239,240,62,17,31,3,123,183,123,182,129,239,17,24,102,159,114,101,121,152,177,238,134,116,96,57,9,230,70,177,95]	t	sW6X6JtmMMGpFQgoApkvZwymbQb67cyNgDL8tFzpump
190	2026-05-14 17:24:17.635034+00	[174,33,255,185,50,195,57,9,242,207,110,13,31,13,23,163,238,40,246,24,249,234,194,163,223,45,28,108,191,154,225,154,154,53,63,53,211,168,89,240,76,20,55,190,159,111,175,211,0,238,174,90,83,7,75,77,24,101,184,221,88,244,154,223]	t	BNxstE9Q6x1n2AHuHFSa9vn5vZNYgwgKGHDdU776pump
194	2026-05-14 17:24:17.704908+00	[223,70,131,227,23,20,254,118,26,61,113,246,53,255,176,145,118,225,11,53,152,225,182,59,113,37,93,76,110,208,81,250,161,203,172,230,88,38,56,190,90,139,138,6,128,16,85,22,92,99,15,166,15,247,117,79,72,131,44,139,162,37,129,15]	t	BtamiGGEdWsd1yLe8WNhJquWxjibbBeLbooGmj8Ppump
198	2026-05-14 17:24:17.770737+00	[152,55,53,24,51,19,220,57,138,87,114,163,84,124,55,30,157,87,202,212,69,126,228,186,152,188,40,255,112,233,193,202,162,70,24,50,58,28,97,49,112,147,203,162,66,34,114,32,21,59,94,197,82,183,129,154,15,251,56,185,117,118,169,239]	t	BvT3G93ZqCtvaRZ3chgiEqSgGnKMVuzsbT1chAf3pump
202	2026-05-14 17:24:17.823872+00	[48,17,197,42,76,218,241,164,17,129,254,172,133,134,133,106,15,102,224,128,87,32,199,211,133,22,28,110,16,244,30,199,241,240,91,171,134,237,181,254,154,214,208,167,228,16,241,83,183,103,33,233,191,77,75,27,25,83,139,198,191,129,248,207]	t	HHRq5zYtoj6Ct5rCuZB63DmHihxGHsJxzwJbVAcFpump
206	2026-05-14 17:24:17.889796+00	[107,244,178,105,245,221,247,3,20,231,174,43,156,68,132,239,124,17,101,81,56,254,9,43,187,229,200,31,71,190,193,151,172,210,40,50,202,47,109,133,2,66,168,67,14,49,184,159,74,175,0,65,75,188,75,48,213,78,219,90,43,217,49,223]	t	CdczJUXTjeXLaHSkffKACryD4nAWYRQLuwH38uhApump
210	2026-05-14 17:24:17.975916+00	[148,247,107,255,251,59,210,13,181,247,68,56,110,150,85,166,175,116,3,41,51,132,201,0,161,252,36,30,161,252,14,49,217,140,42,121,107,205,103,151,200,9,85,71,163,155,66,164,231,120,153,109,171,121,31,176,233,237,24,55,222,252,175,79]	t	FeDSAWL29vijEWHaG9gKXM6aLZhmiUzVttMktrm5pump
214	2026-05-14 17:24:18.039065+00	[90,183,35,121,229,7,63,130,164,171,141,241,252,22,62,224,107,210,84,211,117,226,13,191,67,94,236,134,231,209,138,148,109,172,184,107,65,208,166,223,237,196,208,191,23,202,75,43,249,120,108,199,78,14,107,207,179,131,254,26,249,37,107,31]	t	8P8CF5oMiCuaEQsCEwQxKq3zw4yixbLyFB7iSstgpump
218	2026-05-14 17:24:18.09282+00	[13,99,19,147,217,115,160,39,33,237,30,224,136,129,89,237,171,171,108,62,19,46,225,118,5,76,125,85,123,145,60,218,115,148,236,111,94,110,223,239,181,44,127,59,152,127,23,165,79,43,78,62,59,36,242,17,8,119,146,171,146,164,130,159]	t	8nBbTEpug8RbB3Sy7KvBXpxhfBU7vYnMsLwBT1rcpump
222	2026-05-14 17:24:18.151466+00	[240,158,121,157,171,226,60,195,222,30,249,73,148,44,216,173,169,118,64,104,180,151,176,251,1,59,33,149,117,50,229,34,174,57,195,238,147,90,77,185,85,231,10,62,136,23,46,85,191,20,44,36,129,248,169,221,235,191,84,150,202,13,117,143]	t	Cj72b8WmEvMP1JNPdwMqi8L9c8jhNmDLF4eZ8u1dpump
226	2026-05-14 17:24:18.212982+00	[209,119,205,84,44,92,208,189,77,51,226,75,195,159,220,100,223,62,86,104,19,151,11,62,55,239,4,172,9,11,149,128,211,115,40,188,163,82,138,14,84,254,26,114,217,194,49,202,118,92,226,56,212,213,241,16,232,95,199,101,29,150,0,127]	t	FEQsYsoTqY1C8CeapaBM5cqtojSKdW8cbiFTCKcWpump
230	2026-05-14 17:24:18.268943+00	[94,142,226,138,23,88,98,8,114,226,255,221,41,234,91,66,102,222,34,108,21,251,240,138,127,179,59,224,237,200,254,212,104,135,8,196,202,209,190,174,92,7,123,70,81,166,128,140,188,86,201,245,109,174,69,39,249,183,221,108,249,219,29,15]	t	832pt8iX1EZxLp2HqZww2r6NJ6D5WWywns3Ca8QTpump
234	2026-05-14 17:24:18.323142+00	[117,63,107,149,197,215,9,95,198,245,70,220,229,78,59,123,179,37,193,225,240,170,199,19,206,246,241,72,176,2,15,150,124,101,195,237,44,183,6,146,181,172,104,76,207,156,248,64,149,92,178,86,14,188,168,124,6,170,161,195,171,210,243,207]	t	9NbZGQPXE8zL6ehCmfXX7EaaBnWXWneo3f5m6V83pump
238	2026-05-14 17:24:18.383875+00	[222,218,3,47,221,88,25,183,29,22,60,213,8,93,70,95,140,168,207,202,113,154,235,123,23,93,229,253,130,14,30,92,45,60,140,19,89,212,199,232,18,252,246,33,125,51,103,178,143,232,233,130,248,30,181,160,196,27,118,14,173,174,169,239]	t	43attWoB3SZk3HnCHd8MFW2RgQLJfKSJtELZ3N57pump
242	2026-05-14 17:24:18.441527+00	[169,87,129,169,222,203,110,17,69,193,27,73,94,30,227,128,242,3,208,182,59,218,92,112,95,224,233,198,227,16,139,241,83,106,12,169,255,171,45,179,170,83,66,70,181,176,100,248,175,142,168,10,83,148,84,10,165,125,101,17,141,70,155,159]	t	6ccdWywD38gn3hKDK1p1jPEqGyW5Bhiy4uKqpPDNpump
246	2026-05-14 17:24:18.51836+00	[85,210,160,64,191,141,32,87,2,238,8,148,9,114,30,193,211,91,74,225,93,160,123,107,5,125,174,92,188,49,42,16,205,69,192,54,72,21,213,176,228,109,192,198,242,69,25,62,197,165,231,17,208,170,192,70,152,181,252,13,154,115,27,127]	t	EpJGRv6S5hhJ4t98UNZ8hzz77kVYPUwWDu9JAK3gpump
175	2026-05-14 17:24:17.371494+00	[230,201,186,59,60,158,117,62,110,87,22,55,178,214,110,193,197,78,7,69,243,38,179,245,139,151,133,136,205,209,174,150,70,139,54,215,46,211,37,143,73,86,209,11,96,11,242,174,151,116,39,209,19,251,124,38,40,250,75,186,104,253,170,47]	t	5kNfKHAFTVrRejX2C49JaNEJu59Uyfgu3vGfbshopump
179	2026-05-14 17:24:17.459102+00	[210,84,240,95,214,227,73,82,205,42,198,110,158,134,170,30,30,51,246,34,223,108,126,69,82,217,96,60,176,211,0,218,218,25,221,254,139,36,135,183,155,123,84,15,38,57,117,27,85,131,2,96,226,13,39,252,163,8,27,223,79,148,40,15]	t	FgNkoNZyvU3uRyyqQGpQyvfty9tjqrrJDyaHRWjVpump
183	2026-05-14 17:24:17.533475+00	[150,22,81,193,29,201,65,215,14,149,4,207,23,198,55,105,242,79,143,0,251,11,248,58,249,207,211,225,96,104,38,251,137,221,63,88,207,157,136,214,4,247,99,119,147,89,221,51,139,182,127,72,180,241,73,235,24,35,238,65,110,25,2,111]	t	AHAXZgxqhy2De6rmxZ5DAaqudV97iQdDzs58mF5jpump
187	2026-05-14 17:24:17.596192+00	[126,94,89,84,164,80,16,146,221,224,39,56,83,35,239,174,125,113,161,150,15,92,23,132,224,251,163,79,230,236,124,238,81,66,3,98,143,244,7,111,24,141,58,209,197,139,217,54,158,161,53,48,9,244,176,87,198,135,116,171,188,161,180,207]	t	6UCQYcDkytjNgRacPthtGCXicQDHyRSN49wjJtZmpump
191	2026-05-14 17:24:17.649204+00	[1,212,197,221,74,32,72,19,58,122,195,252,250,26,172,120,140,139,120,197,90,193,53,236,242,99,213,43,21,48,148,21,131,115,151,43,193,114,134,111,232,192,192,82,32,44,110,100,122,56,130,232,249,6,2,4,32,220,180,26,218,161,248,223]	t	9r8dxgN4VuzarV3aD3eZZzfpbfvTaXuSFVruGBuipump
195	2026-05-14 17:24:17.723435+00	[166,96,112,225,166,226,51,220,18,211,35,53,56,170,8,42,217,190,211,218,209,92,70,128,135,105,175,167,253,41,96,164,198,65,38,199,16,23,217,83,162,14,70,162,248,5,200,80,144,46,70,86,19,197,68,37,210,176,233,251,66,88,195,143]	t	ELuLyjcYaSL5pf4Dhv27Yv1YGhe7KvABicjgiXWjpump
199	2026-05-14 17:24:17.785958+00	[196,133,97,222,209,65,102,73,133,114,38,99,127,154,139,11,72,155,38,36,138,241,95,118,171,201,25,35,187,207,203,144,186,192,102,205,32,11,142,233,15,164,35,113,8,39,172,161,102,75,102,147,191,162,22,29,109,143,83,111,28,118,19,95]	t	DZzzaThZYCAmbjDiNHYpE4HzogVfRhBDCxoEbr8Ypump
203	2026-05-14 17:24:17.836971+00	[49,85,232,12,233,54,72,199,234,35,23,196,79,241,167,28,115,190,216,79,42,109,73,44,233,87,7,181,72,225,238,149,9,187,96,218,37,41,137,227,97,92,125,9,207,184,129,219,137,12,162,94,235,225,102,98,210,94,204,234,220,29,72,207]	t	ezPUy1k72gGcZekWaC1fcbVTyGdGkiFivFrDRCKpump
207	2026-05-14 17:24:17.909111+00	[47,202,170,161,221,107,244,18,106,232,167,63,73,76,13,236,182,64,132,145,44,158,249,178,188,191,41,178,86,164,180,0,14,225,201,188,83,207,159,132,149,244,229,82,175,33,215,125,218,88,217,107,22,244,155,217,202,237,241,46,226,31,157,111]	t	216PxdUupssfqMVYFCQBc5FZeaNQUcf5W3GFWDqspump
211	2026-05-14 17:24:17.998456+00	[124,214,92,94,141,107,86,132,86,136,198,189,152,26,90,67,67,52,21,235,118,8,42,251,104,133,178,110,96,21,194,211,75,247,176,162,96,170,167,196,248,153,181,52,28,154,14,161,52,135,207,8,169,218,75,106,132,15,49,16,9,136,68,191]	t	67YdsAy3os1H55h7ZM3yhQV4SCwWUYGcr4e6j3iWpump
215	2026-05-14 17:24:18.055406+00	[155,67,83,208,194,102,30,1,126,174,210,242,108,61,139,43,105,200,87,90,178,25,34,250,20,56,178,245,55,17,158,42,54,213,150,52,180,153,244,47,198,91,182,94,138,76,15,181,251,201,160,154,141,41,140,67,10,154,172,172,112,163,59,239]	t	4h3uwv7JS313bQ4pyCyfer275BtJmreB471XEhBfpump
219	2026-05-14 17:24:18.105704+00	[157,248,42,234,193,220,192,254,203,136,4,153,200,225,176,251,31,122,80,198,12,186,208,51,132,160,37,35,135,152,77,59,141,100,135,236,239,81,180,179,108,66,218,57,104,100,98,195,106,136,214,147,153,28,36,49,202,14,185,147,207,183,101,63]	t	AWwPwNm23vFfcDHT6r9RoTASG3XHAxbgAURLWxWrpump
223	2026-05-14 17:24:18.160939+00	[246,29,19,122,206,213,150,59,241,63,31,242,72,133,129,47,109,205,211,125,46,142,115,232,174,134,201,82,42,46,127,20,26,71,6,152,149,162,243,67,142,184,183,230,99,208,124,149,74,9,7,134,56,83,187,249,93,222,91,113,239,215,155,255]	t	2maR7NvqqbbPvgwdUz2nmxcy74V2S1MubpCWpGrepump
227	2026-05-14 17:24:18.225947+00	[58,199,78,110,195,144,105,53,56,52,101,251,63,131,129,233,216,39,24,111,20,247,151,49,66,189,2,57,92,23,122,210,169,140,129,180,108,26,102,200,28,196,199,181,202,181,236,92,114,28,11,66,99,34,27,151,168,107,115,229,17,228,94,79]	t	CQrAcVd9Thhry4qB3bz8Xo1pyU1vmCf8E6jhmy9hpump
231	2026-05-14 17:24:18.282531+00	[178,3,155,122,99,174,43,146,116,25,169,80,4,184,113,68,163,23,189,138,155,150,92,52,193,96,202,169,157,184,94,168,207,117,186,242,115,52,80,35,153,110,76,254,231,166,76,167,5,212,168,163,107,54,220,17,251,254,105,200,188,245,63,207]	t	ExqWrNgQCrsDgqLsdSp7dgHJ2x52Pgj4K4BpcLD5pump
235	2026-05-14 17:24:18.340564+00	[197,57,174,128,207,47,171,201,43,146,108,45,40,93,204,58,1,130,72,236,127,178,255,104,227,22,143,75,228,243,127,176,103,123,214,48,249,15,164,220,25,252,108,161,26,124,253,23,176,30,68,243,145,50,178,132,135,201,27,143,30,3,219,15]	t	7xxWrKaKSfb2pWE6cYdCPTuf87pdUtYaZQyHCNkTpump
239	2026-05-14 17:24:18.400156+00	[110,6,130,223,192,170,186,163,23,81,113,31,81,24,248,111,138,158,42,100,241,245,130,241,174,46,38,190,112,104,101,12,123,123,130,46,174,149,81,40,139,90,177,178,19,0,26,216,181,88,201,232,40,213,191,125,86,158,194,247,77,236,64,111]	t	9K2NwuSuneLJ3w9EwPjVXsBYJcy4zs7p2gf2MtiMpump
243	2026-05-14 17:24:18.452432+00	[13,226,168,48,175,243,51,200,45,53,203,176,45,170,9,195,36,133,53,69,189,1,219,63,48,13,26,121,57,73,116,99,163,253,124,53,63,204,95,226,226,149,222,47,37,169,172,72,34,65,137,160,127,34,50,123,209,83,113,133,238,136,149,255]	t	C39e2Jt29XZjT3WiYQQE6W9SVZ3P9VCVcJfhMVHLpump
247	2026-05-14 17:24:49.449243+00	[168,149,53,242,125,237,110,210,16,234,70,136,90,1,46,55,237,139,223,146,163,128,237,47,239,190,199,240,201,197,185,148,150,141,163,112,115,142,15,168,109,121,173,56,172,124,66,197,146,23,73,115,144,147,158,223,253,179,175,172,244,200,14,15]	t	B8hRPGmvmYzTyBbFCvpkzdxTb9MePmQYLLf4rpP5pump
\.


--
-- Data for Name: buckets; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") FROM stdin;
token-media	token-media	\N	2026-05-08 19:29:03.188132+00	2026-05-08 19:29:03.188132+00	t	f	\N	\N	\N	STANDARD
\.


--
-- Data for Name: buckets_analytics; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."buckets_analytics" ("name", "type", "format", "created_at", "updated_at", "id", "deleted_at") FROM stdin;
\.


--
-- Data for Name: buckets_vectors; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."buckets_vectors" ("id", "type", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: iceberg_namespaces; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."iceberg_namespaces" ("id", "bucket_name", "name", "created_at", "updated_at", "metadata", "catalog_id") FROM stdin;
\.


--
-- Data for Name: iceberg_tables; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."iceberg_tables" ("id", "namespace_id", "bucket_name", "name", "location", "created_at", "updated_at", "remote_table_id", "shard_key", "shard_id", "catalog_id") FROM stdin;
\.


--
-- Data for Name: objects; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."objects" ("id", "bucket_id", "name", "owner", "created_at", "updated_at", "last_accessed_at", "metadata", "version", "owner_id", "user_metadata") FROM stdin;
a7b497e7-1ef7-46a1-973b-23e2796a9813	token-media	public/.emptyFolderPlaceholder	\N	2026-05-09 13:52:31.52231+00	2026-05-09 13:52:31.52231+00	2026-05-09 13:52:31.52231+00	{"eTag": "\\"d41d8cd98f00b204e9800998ecf8427e\\"", "size": 0, "mimetype": "application/octet-stream", "cacheControl": "max-age=3600", "lastModified": "2026-05-09T13:52:31.511Z", "contentLength": 0, "httpStatusCode": 200}	2dfb419b-b35a-4dde-bde8-9ce58aa72065	\N	{}
c0d225e7-eaeb-4895-a9a7-20148f2d77e4	token-media	public/DONBRAIN_7xtcEjH_logo.png.png	86db7fd5-e7ea-4361-9249-bf3f349de2ee	2026-05-10 17:03:55.700434+00	2026-05-17 21:33:01.587087+00	2026-05-10 17:03:55.700434+00	{"eTag": "\\"45582d9e05c6e1e651e99fe3bfc8354d\\"", "size": 2751113, "mimetype": "image/png", "cacheControl": "max-age=3600", "lastModified": "2026-05-17T21:33:01.560Z", "contentLength": 2751113, "httpStatusCode": 200}	a2df6a4a-4e88-4c03-82c4-8171136a8fb6	86db7fd5-e7ea-4361-9249-bf3f349de2ee	{}
\.


--
-- Data for Name: s3_multipart_uploads; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."s3_multipart_uploads" ("id", "in_progress_size", "upload_signature", "bucket_id", "key", "version", "owner_id", "created_at", "user_metadata", "metadata") FROM stdin;
\.


--
-- Data for Name: s3_multipart_uploads_parts; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."s3_multipart_uploads_parts" ("id", "upload_id", "size", "part_number", "bucket_id", "key", "etag", "owner_id", "version", "created_at") FROM stdin;
\.


--
-- Data for Name: vector_indexes; Type: TABLE DATA; Schema: storage; Owner: supabase_storage_admin
--

COPY "storage"."vector_indexes" ("id", "name", "bucket_id", "data_type", "dimension", "distance_metric", "metadata_configuration", "created_at", "updated_at") FROM stdin;
\.


--
-- Data for Name: hooks; Type: TABLE DATA; Schema: supabase_functions; Owner: supabase_functions_admin
--

COPY "supabase_functions"."hooks" ("id", "hook_table_id", "hook_name", "created_at", "request_id") FROM stdin;
\.


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE SET; Schema: auth; Owner: supabase_auth_admin
--

SELECT pg_catalog.setval('"auth"."refresh_tokens_id_seq"', 70, true);


--
-- Name: owners_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."owners_id_seq"', 3, true);


--
-- Name: profiles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."profiles_id_seq"', 1, false);


--
-- Name: tokens_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."tokens_id_seq"', 1, true);


--
-- Name: transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."transactions_id_seq"', 1, false);


--
-- Name: vanity_contract_addresses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."vanity_contract_addresses_id_seq"', 247, true);


--
-- Name: wallet_groups_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."wallet_groups_id_seq"', 9, true);


--
-- Name: wallet_type_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."wallet_type_id_seq"', 6, true);


--
-- Name: wallets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('"public"."wallets_id_seq"', 9, true);


--
-- Name: hooks_id_seq; Type: SEQUENCE SET; Schema: supabase_functions; Owner: supabase_functions_admin
--

SELECT pg_catalog.setval('"supabase_functions"."hooks_id_seq"', 1, false);


--
-- PostgreSQL database dump complete
--

-- \unrestrict r1GkMv50EQnvtYnVLMM4950Ywpqd0caCtrIouFewPmdZ4jXauEsXV6dLbUe4ktb

RESET ALL;
