import { z } from 'zod';

export const SubstitutionSchema = z.object({
  selector: z.string(),        // ".btn"
  property: z.string(),        // "background-color"
  /** Dotted theme path, resolved to a CSS var at emit. */
  token: z.string(),           // "colors.primary"
  /** Which media block, when the declaration is inside one. */
  media: z.string().optional(),
  original: z.string(),        // "#fff" — kept for the diff at step 7
});