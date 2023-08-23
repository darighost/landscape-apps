import React, { useEffect, useState } from 'react';
import { useIsMobile } from './useMedia';

export default function useLongPress() {
  const [action, setAction] = useState('');
  const isMobile = useIsMobile();
  const timerRef = React.useRef<ReturnType<typeof setTimeout>>();
  const isLongPress = React.useRef(false);

  const start = () => {
    isLongPress.current = false;
    timerRef.current = setTimeout(() => {
      isLongPress.current = true;
      setAction('longpress');
    }, 300);
  };

  const stop = () => {
    clearTimeout(timerRef.current);
    setAction('');
  };

  const onClick = () => {
    if (isLongPress.current) {
      return;
    }
    setAction('click');
  };

  const onMouseDown = () => {
    start();
  };

  const onMouseUp = () => {
    stop();
  };

  const onTouchStart = () => {
    start();
  };

  const onTouchEnd = () => {
    stop();
  };

  const onContextMenu = (e: React.MouseEvent) => {
    if (isMobile && action === 'longpress') {
      e.preventDefault();
    }
  };

  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    },
    []
  );

  return {
    action,
    handlers: {
      onClick,
      onMouseDown,
      onMouseUp,
      onTouchStart,
      onTouchEnd,
      onContextMenu,
    },
  };
}
