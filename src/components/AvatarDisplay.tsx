import React, { useState } from 'react';
import { getAvatarPreset } from '../data/japaneseIdentities';

interface AvatarDisplayProps {
  avatarId: string;
  displayName: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const SIZE_CLASSES: Record<NonNullable<AvatarDisplayProps['size']>, string> = {
  sm: 'w-8 h-8 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
  xl: 'w-20 h-20 text-xl',
};

export const AvatarDisplay: React.FC<AvatarDisplayProps> = ({
  avatarId,
  displayName,
  size = 'md',
}) => {
  const [imgError, setImgError] = useState(false);
  const preset = getAvatarPreset(avatarId);

  return (
    <div
      className={`${SIZE_CLASSES[size]} relative shrink-0 overflow-hidden rounded-lg bg-[#2c2e31] border border-[#444444] flex items-center justify-center select-none`}
      title={`${displayName} (${preset.label})`}
    >
      {!imgError && preset.imageUrl ? (
        <img
          src={preset.imageUrl}
          alt={`${displayName} Japanese identity avatar`}
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#2c2e31] text-[#e2b714] font-semibold">
          <span>{preset.monKanji}</span>
        </div>
      )}
    </div>
  );
};
