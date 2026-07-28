export interface MediaSpecs {
    id:     string,
    items:  MediaSpecItem[],
}

export interface MediaSpecItem {
    id:     string,
    name:   string,
    description: string,
    width:  number | null,
    height: number | null,
    type:   'image' | 'video',
    filetype:   'PNG' | 'JPEG' | 'JPG' | 'SVG' | 'WEBP' | 'GIF' | 'MP4' | 'WEBM' | 'MOV' | 'OGG',
}