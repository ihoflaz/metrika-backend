import { Request, Response, NextFunction } from 'express';
import { unsubscribeService } from '../../../modules/notifications/unsubscribe.service';

/**
 * GET /api/v1/unsubscribe/:token
 * Unsubscribe from email notifications
 */
export async function unsubscribe(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { token } = req.params;

    const result = await unsubscribeService.useToken(token);

    // Simple HTML response
    res.send(`
      <!DOCTYPE html>
      <html lang="tr">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Unsubscribed - Metrika PMO</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background-color: #f3f4f6;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
          }
          .container {
            background: white;
            padding: 48px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            max-width: 500px;
            text-align: center;
          }
          h1 {
            color: #10b981;
            margin-bottom: 16px;
          }
          p {
            color: #6b7280;
            line-height: 1.6;
          }
          .email {
            font-weight: 600;
            color: #374151;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✓ Abonelikten Çıkıldı</h1>
          <p>
            <span class="email">${result.email}</span> adresine gönderilecek 
            ${result.notificationType || 'tüm'} bildirimlerden başarıyla çıkıldı.
          </p>
          <p>
            Tercihlerinizi değiştirmek isterseniz, hesap ayarlarından 
            bildirim tercihlerinizi düzenleyebilirsiniz.
          </p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Invalid')) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="tr">
        <head>
          <meta charset="UTF-8">
          <title>Invalid Link - Metrika PMO</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background-color: #f3f4f6;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
            }
            .container {
              background: white;
              padding: 48px;
              border-radius: 8px;
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
              max-width: 500px;
              text-align: center;
            }
            h1 { color: #ef4444; }
            p { color: #6b7280; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Geçersiz Link</h1>
            <p>Bu link geçersiz veya süresi dolmuş.</p>
          </div>
        </body>
        </html>
      `);
    }

    next(error);
  }
}

/**
 * GET /api/v1/users/me/email-logs
 * Get user's email notification logs
 */
export async function getEmailLogs(
  req: Request & { auth?: { userId: string } },
  res: Response,
  next: NextFunction
) {
  try {
    const userId = req.auth!.userId;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;

    const logs = await unsubscribeService.getUserEmailLogs(userId, limit);

    res.json({ logs, count: logs.length });
  } catch (error) {
    next(error);
  }
}
