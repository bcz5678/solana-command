import { SectionType } from '@/site-platform/schema'

/**
 * New sections get `crypto.randomUUID()` and `order = max + 1` (Form spec.md >
 * Behaviour > Section editor). `slug` is left empty — assignSlugs() derives it
 * from navLabel at publish; the form must never compute or store one
 * (CLAUDE.md > Section identity vs sequence).
 */
export function createSection(type: SectionType, order: number): Record<string, unknown> {
    const base = {
        id: crypto.randomUUID(),
        slug: '',
        order,
        enabled: true,
        navLabel: '',
        showInNav: true,
        kicker: '',
        title: '',
        backgroundColor: '',
        crossAlign: 'start',
    }

    switch (type) {
        case 'prose':
            return { ...base, type, body: [] }
        case 'stats':
            return { ...base, type, intro: '', stats: [] }
        case 'timeline':
            return { ...base, type, intro: '', milestones: [] }
        case 'gallery':
            return { ...base, type, intro: '', images: [], layout: 'grid' }
        case 'faq':
            return { ...base, type, intro: '', items: [] }
        case 'embed':
            return { ...base, type, embedUrl: '', embedTitle: '', aspectRatio: '16/9' }
        case 'cards':
            return { ...base, type, intro: '', cards: [] }
    }
}
