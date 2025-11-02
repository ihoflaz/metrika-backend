import { notificationService } from '../notifications/notification.service';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * HTML email formatını test et
 * MailHog'da "HTML" sekmesine tıklayarak görüntüle
 */
async function testHtmlEmail() {
  try {
    console.log('🧪 HTML Email Format Test Başlatılıyor...\n');

    // Test kullanıcısını bul veya oluştur
    let testUser = await prisma.user.findFirst({
      where: { email: 'test-html@metrika.local' },
    });

    if (!testUser) {
      console.log('📝 Test kullanıcısı oluşturuluyor...');
      const { randomUUID } = await import('crypto');
      testUser = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: 'test-html@metrika.local',
          fullName: 'HTML Test User',
          passwordHash: 'dummy_hash_for_testing',
          status: 'ACTIVE',
        },
      });
    }

    console.log(`✅ Test kullanıcısı hazır: ${testUser.email}\n`);

    // HTML email gönder (task-assigned template - renkli ve güzel)
    console.log('📧 HTML email gönderiliyor...');
    await notificationService.send({
      type: 'task-assigned',
      taskId: 'test-task-id',
      taskTitle: '🎨 HTML Format Test - Bu Email Renkli Görünmeli!',
      projectName: 'HTML Test Project',
      assignedToName: testUser.fullName,
      assignedToEmail: testUser.email,
      assignedByName: 'System Tester',
      taskUrl: 'http://localhost:3000/tasks/test',
    });

    console.log('\n✅ Email gönderildi!\n');
    console.log('📋 MailHog Kontrol Adımları:');
    console.log('1. http://localhost:8025 adresini tarayıcıda aç');
    console.log('2. Son gelen email\'i aç (Subject: "📋 Yeni Görev Atandı...")');
    console.log('3. Üstteki sekmelerde "HTML" sekmesine tıkla');
    console.log('4. Eğer "Plain text" sekmesi aktif ise HTML render edilmemiş olabilir\n');
    
    console.log('🔍 Email Header\'ları:');
    console.log('- Content-Type: multipart/alternative olmalı');
    console.log('- İçinde hem text/plain hem text/html; charset=utf-8 olmalı\n');

    console.log('💡 Plain text görünüyorsa:');
    console.log('- Email client (MailHog) HTML\'i plain text\'e dönüştürüyor olabilir');
    console.log('- Gerçek email client\'larda (Gmail, Outlook) düzgün görünür');
    console.log('- MailHog\'da "HTML" sekmesini manuel seçmek gerekebilir\n');

    await prisma.$disconnect();
  } catch (error) {
    console.error('❌ Test hatası:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

testHtmlEmail();
