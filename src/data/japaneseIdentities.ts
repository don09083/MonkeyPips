import avatarMale1 from '../assets/images/avatar_jp_male_1_1791470712402.jpg';
import avatarMale2 from '../assets/images/avatar_jp_male_2_1791470731003.jpg';
import avatarFemale1 from '../assets/images/avatar_jp_female_1_1791470742730.jpg';
import avatarFemale2 from '../assets/images/avatar_jp_female_2_1791470753249.jpg';
import avatarNeutral1 from '../assets/images/avatar_jp_neutral_1_1791470766120.jpg';

export type IdentityGender = 'male' | 'female' | 'neutral';

export interface AvatarPreset {
  id: string;
  gender: IdentityGender;
  label: string;
  imageUrl: string;
  monKanji: string;
}

export const AVATAR_PRESETS: Record<string, AvatarPreset> = {
  jp_male_1: {
    id: 'jp_male_1',
    gender: 'male',
    label: 'Kenji Frame',
    imageUrl: avatarMale1,
    monKanji: '侍',
  },
  jp_male_2: {
    id: 'jp_male_2',
    gender: 'male',
    label: 'Haruki Crest',
    imageUrl: avatarMale2,
    monKanji: '龍',
  },
  jp_female_1: {
    id: 'jp_female_1',
    gender: 'female',
    label: 'Aoi Pin',
    imageUrl: avatarFemale1,
    monKanji: '桜',
  },
  jp_female_2: {
    id: 'jp_female_2',
    gender: 'female',
    label: 'Yui Knot',
    imageUrl: avatarFemale2,
    monKanji: '月',
  },
  jp_neutral_1: {
    id: 'jp_neutral_1',
    gender: 'neutral',
    label: 'Sora Wave',
    imageUrl: avatarNeutral1,
    monKanji: '空',
  },
};

interface JapaneseNameEntry {
  romaji: string;
  kanji: string;
}

const SURNAMES: JapaneseNameEntry[] = [
  { romaji: 'Takahashi', kanji: '高橋' },
  { romaji: 'Sato', kanji: '佐藤' },
  { romaji: 'Suzuki', kanji: '鈴木' },
  { romaji: 'Watanabe', kanji: '渡辺' },
  { romaji: 'Tanaka', kanji: '田中' },
  { romaji: 'Ito', kanji: '伊藤' },
  { romaji: 'Yamamoto', kanji: '山本' },
  { romaji: 'Nakamura', kanji: '中村' },
  { romaji: 'Kobayashi', kanji: '小林' },
  { romaji: 'Kato', kanji: '加藤' },
  { romaji: 'Yoshida', kanji: '吉田' },
  { romaji: 'Yamada', kanji: '山田' },
  { romaji: 'Sasaki', kanji: '佐々木' },
  { romaji: 'Yamaguchi', kanji: '山口' },
  { romaji: 'Matsumoto', kanji: '松本' },
  { romaji: 'Inoue', kanji: '井上' },
  { romaji: 'Kimura', kanji: '木村' },
  { romaji: 'Hayashi', kanji: '林' },
  { romaji: 'Shimizu', kanji: '清水' },
  { romaji: 'Mori', kanji: '森' },
];

const GIVEN_NAMES: Record<IdentityGender, JapaneseNameEntry[]> = {
  male: [
    { romaji: 'Kenji', kanji: '健二' },
    { romaji: 'Haruki', kanji: '春樹' },
    { romaji: 'Ren', kanji: '蓮' },
    { romaji: 'Takumi', kanji: '拓海' },
    { romaji: 'Daiki', kanji: '大輝' },
    { romaji: 'Kaito', kanji: '海斗' },
    { romaji: 'Sota', kanji: '颯太' },
    { romaji: 'Riku', kanji: '陸' },
    { romaji: 'Yuto', kanji: '悠斗' },
    { romaji: 'Kazuki', kanji: '一樹' },
    { romaji: 'Ryota', kanji: '亮太' },
    { romaji: 'Shinji', kanji: '慎司' },
  ],
  female: [
    { romaji: 'Yui', kanji: '結衣' },
    { romaji: 'Himari', kanji: '陽葵' },
    { romaji: 'Akari', kanji: '朱里' },
    { romaji: 'Hina', kanji: '陽菜' },
    { romaji: 'Mio', kanji: '澪' },
    { romaji: 'Sakura', kanji: 'さくら' },
    { romaji: 'Nanami', kanji: '七海' },
    { romaji: 'Ayaka', kanji: '彩花' },
    { romaji: 'Koharu', kanji: '心春' },
    { romaji: 'Riko', kanji: '莉子' },
    { romaji: 'Mei', kanji: '芽依' },
    { romaji: 'kaede', kanji: '楓' },
  ],
  neutral: [
    { romaji: 'Sora', kanji: '空' },
    { romaji: 'Aoi', kanji: '葵' },
    { romaji: 'Makoto', kanji: '誠' },
    { romaji: 'Haru', kanji: '陽' },
    { romaji: 'Hikari', kanji: '光' },
    { romaji: 'itsuki', kanji: '樹' },
    { romaji: 'Minato', kanji: '湊' },
    { romaji: 'Asahi', kanji: '朝日' },
    { romaji: 'Nagi', kanji: '凪' },
    { romaji: 'Rei', kanji: '零' },
    { romaji: 'Tsubasa', kanji: '翼' },
    { romaji: ' Kaoru', kanji: '薫' },
  ],
};

const AVATARS_BY_GENDER: Record<IdentityGender, string[]> = {
  male: ['jp_male_1', 'jp_male_2'],
  female: ['jp_female_1', 'jp_female_2'],
  neutral: ['jp_neutral_1', 'jp_male_2', 'jp_female_1'],
};

export interface GeneratedIdentity {
  displayName: string;
  gender: IdentityGender;
  avatarId: string;
}

export function generateRandomJapaneseIdentity(
  gender: IdentityGender,
  currentDisplayName?: string
): GeneratedIdentity {
  const pool = GIVEN_NAMES[gender] || GIVEN_NAMES.neutral;
  const avatarPool = AVATARS_BY_GENDER[gender] || AVATARS_BY_GENDER.neutral;

  let formattedName = '';
  let attempts = 0;

  do {
    const surname = SURNAMES[Math.floor(Math.random() * SURNAMES.length)];
    const given = pool[Math.floor(Math.random() * pool.length)];
    const cleanRomajiGiven =
      given.romaji.trim().charAt(0).toUpperCase() + given.romaji.trim().slice(1);
    formattedName = `${surname.romaji} ${cleanRomajiGiven} (${surname.kanji} ${given.kanji})`;
    attempts++;
  } while (formattedName === currentDisplayName && attempts < 10);

  // Truncate defensively to 80 chars max per firebase-blueprint.json
  const safeDisplayName = formattedName.slice(0, 80);
  const randomAvatarId =
    avatarPool[Math.floor(Math.random() * avatarPool.length)];

  return {
    displayName: safeDisplayName,
    gender,
    avatarId: randomAvatarId,
  };
}

export function getAvatarPreset(avatarId: string): AvatarPreset {
  return AVATAR_PRESETS[avatarId] || AVATAR_PRESETS.jp_neutral_1;
}
