export type ChatComposerKey = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey">;

export function shouldSendChatFromKeyboard(event: ChatComposerKey): boolean {
  void event;
  return false;
}

export function canSendChatDraft(text: string, canSend: boolean, sending: boolean): boolean {
  return canSend && !sending && text.trim().length > 0;
}
