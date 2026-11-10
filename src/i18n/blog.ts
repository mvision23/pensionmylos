import { getCollection, type CollectionEntry } from 'astro:content';
import type { Locale } from './config';

type Post = CollectionEntry<'blog'>;

/** Posts live in src/content/blog/<lang>/<slug>.md — the slug is shared by all translations. */
export const postSlug = (post: Post) => post.id.split('/').pop()!;

export async function getPosts(locale: Locale): Promise<Post[]> {
  return (await getCollection('blog', ({ data }) => !data.draft && data.lang === locale)).sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf(),
  );
}

/** Which languages a post (by slug) exists in. */
export async function translationsOf(slug: string): Promise<Locale[]> {
  const all = await getCollection('blog', ({ data }) => !data.draft);
  return all.filter((p) => postSlug(p) === slug).map((p) => p.data.lang);
}
