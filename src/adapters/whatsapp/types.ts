export interface WhatsAppGateway {
  hasActiveSession(userId: string): Promise<boolean>;
  sendSessionMessage(to: string, body: string): Promise<{ id: string }>;
  sendTemplateMessage(to: string, templateName: string, params: Record<string, string>): Promise<{ id: string }>;
}
