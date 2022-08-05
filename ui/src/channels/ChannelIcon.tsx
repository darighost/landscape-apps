import React from 'react';
import BubbleIcon from '@/components/icons/BubbleIcon';
import UnknownAvatarIcon from '@/components/icons/UnknownAvatarIcon';
import { nestToFlag } from '@/logic/utils';
import ShapesIcon from '@/components/icons/ShapesIcon';

interface ChannelIconProps extends React.HTMLAttributes<SVGElement> {
  nest: string;
}

export default function ChannelIcon({ nest, ...rest }: ChannelIconProps) {
  const [app] = nestToFlag(nest);
  switch (app) {
    case 'chat':
      return <BubbleIcon {...rest} />;
    case 'heap':
      return <ShapesIcon {...rest} />;
    default:
      return <UnknownAvatarIcon {...rest} />;
  }
}
