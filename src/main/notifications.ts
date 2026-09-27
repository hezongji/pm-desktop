/** 原生系统通知（规格书 §4.6 notify:show / §4.4 更新提示） */
import { Notification } from 'electron';
import { log } from './diagnostics';

export interface NotifyOptions {
  title: string;
  body: string;
  onClick?: () => void;
  silent?: boolean;
}

export function notify(options: NotifyOptions): boolean {
  if (!Notification.isSupported()) {
    log.warn('[notify] 当前系统不支持原生通知');
    return false;
  }
  try {
    const notification = new Notification({
      title: options.title,
      body: options.body,
      silent: options.silent ?? false,
    });
    if (options.onClick) notification.on('click', options.onClick);
    notification.show();
    return true;
  } catch (error) {
    log.warn(`[notify] 发送失败：${String(error)}`);
    return false;
  }
}
