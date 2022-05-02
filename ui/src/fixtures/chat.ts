import { decToUd, unixToDa } from '@urbit/api';
import { subMinutes } from 'date-fns';
import { ChatWrit, ChatMessage } from '../types/chat';

// eslint-disable-next-line import/prefer-default-export
export const makeChatWrit = (
  count: number,
  author: string,
  content: ChatMessage,
  feels?: Record<string, string>,
  setTime?: Date
): ChatWrit => {
  const unix = subMinutes(setTime ? setTime : new Date(), count * 5).getTime();
  const time = unixToDa(unix);
  const da = decToUd(time.toString());
  return {
    seal: {
      time: da,
      feels: feels ?? {},
    },
    memo: {
      replying: null,
      author,
      sent: unix,
      content,
    },
  };
};
