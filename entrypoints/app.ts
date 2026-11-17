// Скрипт, который выполняется в контексте страницы Confluence (world: MAIN).
// Регистрируется из background.ts для адресов, заданных в настройках.
import { defineUnlistedScript } from '#imports';
import { startApp } from '../core/app';

export default defineUnlistedScript(() => {
  startApp();
});
