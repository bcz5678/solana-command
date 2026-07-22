export interface SiteInput {
    type:           'string' | 'image' | 'color',
    label:          string,
    description:    string | null,
    default:        string | null,
    display:        boolean
}