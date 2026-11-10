import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getMessages, localeFromParam, localeParams, localePath } from '../../i18n/utils';
import { getPosts, postSlug } from '../../i18n/blog';

export const getStaticPaths = localeParams;

export async function GET(context: APIContext) {
  const locale = localeFromParam(context.params.locale);
  const t = getMessages(locale).blog;
  const posts = await getPosts(locale);
  return rss({
    title: t.rssTitle,
    description: t.rssDescription,
    site: context.site!,
    customData: `<language>${locale}</language>`,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: localePath(locale, `/blog/${postSlug(post)}/`),
    })),
  });
}
