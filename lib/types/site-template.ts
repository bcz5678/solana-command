import { MediaSpecs } from './site-media'

export interface SiteTemplate {
    id:             string,
    name:           string,
    description:    string | null,
    preview_image:  string | null,
    is_active:      boolean,
    created_at:     string,
    updated_at:     string,
}
