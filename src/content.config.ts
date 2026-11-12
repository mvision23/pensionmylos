import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { locales } from './i18n/config';

const blog = defineCollection({
  loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string(),
        description: z.string(),
        pubDate: z.coerce.date(),
        updatedDate: z.coerce.date().optional(),
        /** Optional: posts without a fitting real photo get a branded placeholder. */
        heroImage: image().optional(),
        heroAlt: z.string().optional(),
        /** Language of the post (sets <html lang> and the page's UI strings). */
        lang: z.enum(locales).default('en'),
        tags: z.array(z.string()).default([]),
        draft: z.boolean().default(false),
      })
      .refine((d) => !d.heroImage || !!d.heroAlt, {
        message: 'heroAlt is required when heroImage is set',
        path: ['heroAlt'],
      }),
});

/**
 * Legal pages, one Markdown file per language: src/content/legal/<lang>.md
 * (entry id = language). Rendered by src/pages/[...locale]/privacy.astro.
 */
const legal = defineCollection({
  loader: glob({ base: './src/content/legal', pattern: '*.md' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
  }),
});

export const collections = { blog, legal };
