import { describe, expect, it } from 'vitest';
import { parseYouTubeUrl, youtubeEmbedSrc, youtubeOpenUrl, youtubeStillUrl } from './youtube';

describe('parseYouTubeUrl', () => {
  it('parses YouTube Music watch links without iframe embeds', () => {
    const ref = parseYouTubeUrl('https://music.youtube.com/watch?v=Sqr11UsC000');
    expect(ref).toEqual({
      videoId: 'Sqr11UsC000',
      listId: undefined,
      sourceUrl: 'https://music.youtube.com/watch?v=Sqr11UsC000',
      music: true
    });
    expect(youtubeEmbedSrc(ref!)).toBeNull();
    expect(youtubeOpenUrl(ref!)).toBe('https://www.youtube.com/watch?v=Sqr11UsC000');
    expect(youtubeStillUrl(ref!)).toBe('https://i.ytimg.com/vi/Sqr11UsC000/hqdefault.jpg');
  });

  it('parses www, mobile, short, and shorts URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=Sqr11UsC000')?.videoId).toBe(
      'Sqr11UsC000'
    );
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=Sqr11UsC000')?.music).toBe(false);
    expect(parseYouTubeUrl('https://m.youtube.com/watch?v=Sqr11UsC000')?.videoId).toBe(
      'Sqr11UsC000'
    );
    expect(parseYouTubeUrl('https://youtu.be/Sqr11UsC000')?.videoId).toBe('Sqr11UsC000');
    expect(parseYouTubeUrl('https://www.youtube.com/shorts/Sqr11UsC000')?.videoId).toBe(
      'Sqr11UsC000'
    );
    expect(youtubeEmbedSrc(parseYouTubeUrl('https://youtu.be/Sqr11UsC000')!)).toBe(
      'https://www.youtube-nocookie.com/embed/Sqr11UsC000'
    );
  });

  it('keeps playlist ids when present', () => {
    const ref = parseYouTubeUrl(
      'https://www.youtube.com/watch?v=Sqr11UsC000&list=PLabcdefghijklmnopqrstuv'
    );
    expect(ref?.listId).toBe('PLabcdefghijklmnopqrstuv');
    expect(youtubeEmbedSrc(ref!)).toContain('list=PLabcdefghijklmnopqrstuv');
  });

  it('drops YouTube Music radio mix lists that swap the video', () => {
    const ref = parseYouTubeUrl(
      'https://music.youtube.com/watch?v=1_UoN8cKsEw&list=RDAMVM3iJY3WSXnWM'
    );
    expect(ref?.videoId).toBe('1_UoN8cKsEw');
    expect(ref?.listId).toBeUndefined();
    expect(youtubeOpenUrl(ref!)).toBe('https://www.youtube.com/watch?v=1_UoN8cKsEw');
  });

  it('rejects non-YouTube URLs', () => {
    expect(parseYouTubeUrl('https://vimeo.com/123')).toBeNull();
    expect(parseYouTubeUrl('https://youtube.com/watch?v=short')).toBeNull();
  });
});
