import type { ChatService } from '../schemas/chat.js';

export const mockChat: ChatService = async () => ({
  reply: 'Welcome to WrenchPath ATL. What type of automotive role would you like to move into?',
});
