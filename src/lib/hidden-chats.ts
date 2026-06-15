const STORAGE_KEY = "fileshot-hidden-chats";

function readHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeHidden(ids: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

export function hideChatRoom(roomId: string) {
  if (!roomId) return;
  const hidden = readHidden();
  hidden.add(roomId);
  writeHidden(hidden);
}

export function filterHiddenChats<T extends { roomId?: string }>(rooms: T[]): T[] {
  const hidden = readHidden();
  if (!hidden.size) return rooms;
  return rooms.filter((r) => !r.roomId || !hidden.has(r.roomId));
}
