import { describe, expect, it } from 'vitest';
import { parseYouTubeUrl, youtubeEmbedSrc } from './youtube';

describe('parseYouTubeUrl', () => {
  it('parses YouTube Music watch links', () => {
    const ref = parseYouTubeUrl('https://music.youtube.com/watch?v=Sqr11UsC000');
    expect(ref).toEqual({
      videoId: 'Sqr11UsC000',
      listId: undefined,
      sourceUrl: 'https://music.youtube.com/watch?v=Sqr11UsC000'
    });
    expect(youtubeEmbedSrc(ref!)).toBe('https://www.youtube-nocookie.com/embed/Sqr11UsC000');
  });

  it('parses www, mobile, short, and shorts URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=Sqr11UsC000')?.videoId).toBe(
      'Sqr11UsC000'
    );
    expect(parseYouTubeUrl('https://m.youtube.com/watch?v=Sqr11UsC000')?.videoId).toBe(
      'Sqr11UsC000'
    );
    expect(parseYouTubeUrl('https://youtu.be/Sqr11UsC000')?.videoId).toBe('Sqr11UsC000');
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/Sqr11UsC000')?.videoId).toBe(
      'Sqr11UsC000'
    );
  });

  it('keeps playlist ids when present', () => {
    const ref = parseYouTubeUrl(
      'https://www.youtube.com/watch?v=Sqr11UsC000&list=PLabcdefghijklmnopqrstuv'
    );
    expect(ref?.listId).toBe('PLabcdefghijklmnopqrstuv');
    expect(youtubeEmbedSrc(ref!)).toContain('list=PLabcdefghijklmnopqrstuv');
  });

  it('rejects non-YouTube URLs', () => {
    expect(parseYouTubeUrl('https://vimeo.com/123')).toBeNull();
    expect(parseYouTubeUrl('https://youtube.com/watch?v=short')).toBeNull();
  });
});
