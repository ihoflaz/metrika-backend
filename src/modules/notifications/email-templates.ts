/**
 * Modern HTML Email Templates for Metrika
 * Uses responsive design with inline CSS for maximum compatibility
 */

const baseStyles = `
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      line-height: 1.6;
      color: #333333;
      margin: 0;
      padding: 0;
      background-color: #f4f4f7;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #ffffff;
      padding: 30px 40px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 600;
    }
    .content {
      padding: 40px;
    }
    .content p {
      margin: 0 0 16px;
      font-size: 16px;
    }
    .alert {
      background-color: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 16px;
      margin: 24px 0;
      border-radius: 4px;
    }
    .alert.danger {
      background-color: #f8d7da;
      border-left-color: #dc3545;
    }
    .alert.info {
      background-color: #d1ecf1;
      border-left-color: #0dcaf0;
    }
    .info-box {
      background-color: #f8f9fa;
      border-radius: 4px;
      padding: 20px;
      margin: 24px 0;
    }
    .info-box .label {
      font-weight: 600;
      color: #495057;
      margin-bottom: 4px;
    }
    .info-box .value {
      color: #212529;
      font-size: 16px;
    }
    .button {
      display: inline-block;
      padding: 14px 32px;
      background-color: #667eea;
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      margin: 16px 0;
      text-align: center;
    }
    .button:hover {
      background-color: #5568d3;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 24px 40px;
      text-align: center;
      font-size: 14px;
      color: #6c757d;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
  </style>
`;

export interface TaskCommentEmailData {
  taskTitle: string;
  taskStatus: string;
  taskId: string;
  commenterName: string;
  commenterEmail: string;
  commentText: string;
  projectName?: string;
}

export interface ApprovalReminderEmailData {
  documentTitle: string;
  versionNo: string;
  projectName: string;
  documentId: string;
  versionId: string;
  hoursPending: number;
}

export interface ApprovalEscalationEmailData extends ApprovalReminderEmailData {
  pendingApprovers: string[];
}

export interface TaskOverdueEmailData {
  taskTitle: string;
  taskId: string;
  plannedStart: string;
  projectName?: string;
}

export function generateTaskCommentEmail(data: TaskCommentEmailData): string {
  return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Yeni Görev Yorumu</title>
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>💬 Yeni Yorum Eklendi</h1>
    </div>
    
    <div class="content">
      <p>Merhaba,</p>
      
      <p><strong>${data.commenterName}</strong> (<a href="mailto:${data.commenterEmail}">${data.commenterEmail}</a>) 
      <strong>"${data.taskTitle}"</strong> görevine yeni bir yorum ekledi.</p>
      
      <div class="info-box">
        <div class="label">Görev Durumu:</div>
        <div class="value">${data.taskStatus}</div>
        ${data.projectName ? `
        <div class="label" style="margin-top: 12px;">Proje:</div>
        <div class="value">${data.projectName}</div>
        ` : ''}
      </div>
      
      <div class="alert info">
        <strong>Yorum:</strong><br>
        ${data.commentText}
      </div>
      
      <p style="text-align: center;">
        <a href="#" class="button">Görevi İncele</a>
      </p>
      
      <p style="font-size: 14px; color: #6c757d;">
        Görev ID: ${data.taskId}
      </p>
    </div>
    
    <div class="footer">
      <p>Bu e-posta <strong>Metrika Proje Yönetim Sistemi</strong> tarafından otomatik olarak gönderilmiştir.</p>
      <p><a href="#">Bildirim Ayarları</a> | <a href="#">Destek</a></p>
    </div>
  </div>
</body>
</html>
  `;
}

export function generateApprovalReminderEmail(data: ApprovalReminderEmailData): string {
  return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Onay Hatırlatması</title>
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⏰ Onay Hatırlatması</h1>
    </div>
    
    <div class="content">
      <p>Merhaba,</p>
      
      <div class="alert">
        <strong>Önemli:</strong> Aşağıdaki doküman ${data.hoursPending} saattir onayınızı bekliyor.
      </div>
      
      <div class="info-box">
        <div class="label">Doküman:</div>
        <div class="value">${data.documentTitle}</div>
        
        <div class="label" style="margin-top: 12px;">Versiyon:</div>
        <div class="value">${data.versionNo}</div>
        
        <div class="label" style="margin-top: 12px;">Proje:</div>
        <div class="value">${data.projectName}</div>
        
        <div class="label" style="margin-top: 12px;">Durum:</div>
        <div class="value">İnceleme Bekliyor</div>
      </div>
      
      <p>Lütfen dokümanı inceleyin ve onay sürecini tamamlayın. Zamanında onay vermek, proje akışının kesintisiz devam etmesini sağlar.</p>
      
      <p style="text-align: center;">
        <a href="#" class="button">Dokümanı İncele ve Onayla</a>
      </p>
      
      <p style="font-size: 14px; color: #6c757d;">
        Doküman ID: ${data.documentId}<br>
        Versiyon ID: ${data.versionId}
      </p>
    </div>
    
    <div class="footer">
      <p>Bu e-posta <strong>Metrika Proje Yönetim Sistemi</strong> tarafından otomatik olarak gönderilmiştir.</p>
      <p><a href="#">Bildirim Ayarları</a> | <a href="#">Destek</a></p>
    </div>
  </div>
</body>
</html>
  `;
}

export function generateApprovalEscalationEmail(data: ApprovalEscalationEmailData): string {
  return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Onay Süresi Aşıldı - ESKALASYON</title>
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚨 ESKALASYON: Onay Süresi Aşıldı</h1>
    </div>
    
    <div class="content">
      <p>Sayın Yönetici,</p>
      
      <div class="alert danger">
        <strong>UYARI:</strong> Aşağıdaki doküman ${data.hoursPending} saattir onay bekliyor ve süre aşımı gerçekleşti!
      </div>
      
      <div class="info-box">
        <div class="label">Doküman:</div>
        <div class="value">${data.documentTitle}</div>
        
        <div class="label" style="margin-top: 12px;">Versiyon:</div>
        <div class="value">${data.versionNo}</div>
        
        <div class="label" style="margin-top: 12px;">Proje:</div>
        <div class="value">${data.projectName}</div>
        
        <div class="label" style="margin-top: 12px;">Onay Bekleyen:</div>
        <div class="value">${data.pendingApprovers.join(', ')}</div>
        
        <div class="label" style="margin-top: 12px;">Bekleyen Onay Sayısı:</div>
        <div class="value">${data.pendingApprovers.length}</div>
      </div>
      
      <p>Onay sürecinin uzaması proje akışını olumsuz etkilemektedir. Lütfen onaylamaktan sorumlu kişilerle iletişime geçerek süreci hızlandırın.</p>
      
      <p style="text-align: center;">
        <a href="#" class="button">Onay Durumunu İncele</a>
      </p>
      
      <p style="font-size: 14px; color: #6c757d;">
        Doküman ID: ${data.documentId}<br>
        Versiyon ID: ${data.versionId}
      </p>
    </div>
    
    <div class="footer">
      <p>Bu e-posta <strong>Metrika Proje Yönetim Sistemi</strong> tarafından otomatik olarak gönderilmiştir.</p>
      <p><a href="#">Bildirim Ayarları</a> | <a href="#">Destek</a></p>
    </div>
  </div>
</body>
</html>
  `;
}

export function generateTaskOverdueEmail(data: TaskOverdueEmailData): string {
  return `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Görev Gecikti</title>
  ${baseStyles}
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>⚠️ Planlanan Görev Gecikti</h1>
    </div>
    
    <div class="content">
      <p>Merhaba,</p>
      
      <div class="alert">
        <strong>Dikkat:</strong> Aşağıdaki görev planlanan başlangıç zamanını geçti.
      </div>
      
      <div class="info-box">
        <div class="label">Görev:</div>
        <div class="value">${data.taskTitle}</div>
        
        ${data.projectName ? `
        <div class="label" style="margin-top: 12px;">Proje:</div>
        <div class="value">${data.projectName}</div>
        ` : ''}
        
        <div class="label" style="margin-top: 12px;">Planlanan Başlangıç:</div>
        <div class="value">${data.plannedStart}</div>
      </div>
      
      <p>Lütfen görevin durumunu kontrol edin ve gerekli aksiyonları alın. Zamanında başlamayan görevler proje zaman çizelgesini olumsuz etkileyebilir.</p>
      
      <p style="text-align: center;">
        <a href="#" class="button">Görevi İncele</a>
      </p>
      
      <p style="font-size: 14px; color: #6c757d;">
        Görev ID: ${data.taskId}
      </p>
    </div>
    
    <div class="footer">
      <p>Bu e-posta <strong>Metrika Proje Yönetim Sistemi</strong> tarafından otomatik olarak gönderilmiştir.</p>
      <p><a href="#">Bildirim Ayarları</a> | <a href="#">Destek</a></p>
    </div>
  </div>
</body>
</html>
  `;
}
