import MessagesSidebar from '@/dms/MessagesSidebar';
import { useIsMobile } from '@/logic/useMedia';
import { Outlet } from 'react-router';

export default function TalkNav() {
  const isMobile = useIsMobile();

  return (
    <div className="fixed flex h-full w-full">
      {isMobile ? null : <MessagesSidebar />}
      <Outlet />
    </div>
  );
}
