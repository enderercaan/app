(()=>{
'use strict';
const allowedActions=new Set(['sign_in','sign_up','password_reset','phone_otp']);
const params=new URLSearchParams(location.search);
const action=params.get('action')||'';
const state=params.get('state')||'';
const requested=(params.get('lang')||navigator.language||'en').toLowerCase();
const base=requested.split('-')[0];
const locale=requested.startsWith('pt-br')?'pt-BR':requested.startsWith('zh-hant')?'zh-Hant':requested.startsWith('zh-hans')?'zh-Hans':(['en','es','fr','de','it','ru','tr','ar','hi','id','ja','ko','nl','pl','th','vi'].includes(base)?base:'en');
const copy={
 en:['Security check','Complete this quick verification to continue securely in Tailmance.','Checking…','Verified. Returning to Tailmance…','Verification could not start. Close this page and try again.','Cancel'],
 tr:['Güvenlik kontrolü','Tailmance’e güvenli şekilde devam etmek için bu kısa doğrulamayı tamamla.','Kontrol ediliyor…','Doğrulandı. Tailmance’e dönülüyor…','Doğrulama başlatılamadı. Bu sayfayı kapatıp tekrar dene.','İptal'],
 es:['Control de seguridad','Completa esta verificación rápida para continuar de forma segura en Tailmance.','Comprobando…','Verificado. Volviendo a Tailmance…','No se pudo iniciar la verificación. Cierra esta página e inténtalo de nuevo.','Cancelar'],
 'pt-BR':['Verificação de segurança','Conclua esta verificação rápida para continuar com segurança no Tailmance.','Verificando…','Verificado. Voltando ao Tailmance…','Não foi possível iniciar a verificação. Feche esta página e tente novamente.','Cancelar'],
 fr:['Vérification de sécurité','Effectuez cette vérification rapide pour continuer en toute sécurité dans Tailmance.','Vérification…','Vérifié. Retour à Tailmance…','La vérification n’a pas pu démarrer. Fermez cette page et réessayez.','Annuler'],
 de:['Sicherheitsprüfung','Schließe diese kurze Prüfung ab, um Tailmance sicher weiterzuverwenden.','Prüfung…','Bestätigt. Zurück zu Tailmance…','Die Prüfung konnte nicht gestartet werden. Schließe diese Seite und versuche es erneut.','Abbrechen'],
 it:['Controllo di sicurezza','Completa questa rapida verifica per continuare in sicurezza su Tailmance.','Verifica…','Verificato. Ritorno a Tailmance…','Impossibile avviare la verifica. Chiudi questa pagina e riprova.','Annulla'],
 ru:['Проверка безопасности','Пройдите быструю проверку, чтобы безопасно продолжить в Tailmance.','Проверка…','Готово. Возвращаемся в Tailmance…','Не удалось запустить проверку. Закройте страницу и попробуйте снова.','Отмена'],
 ar:['تحقق أمني','أكمل هذا التحقق السريع للمتابعة بأمان في Tailmance.','جارٍ التحقق…','تم التحقق. العودة إلى Tailmance…','تعذر بدء التحقق. أغلق هذه الصفحة وحاول مجددًا.','إلغاء'],
 hi:['सुरक्षा जाँच','Tailmance में सुरक्षित रूप से आगे बढ़ने के लिए यह त्वरित सत्यापन पूरा करें।','जाँच हो रही है…','सत्यापित। Tailmance पर लौट रहे हैं…','सत्यापन शुरू नहीं हो सका। यह पेज बंद करके फिर कोशिश करें।','रद्द करें'],
 id:['Pemeriksaan keamanan','Selesaikan verifikasi singkat ini untuk melanjutkan dengan aman di Tailmance.','Memeriksa…','Terverifikasi. Kembali ke Tailmance…','Verifikasi tidak dapat dimulai. Tutup halaman ini lalu coba lagi.','Batal'],
 ja:['セキュリティ確認','Tailmanceを安全に利用するため、この簡単な確認を完了してください。','確認中…','確認できました。Tailmanceに戻ります…','確認を開始できませんでした。このページを閉じて再試行してください。','キャンセル'],
 ko:['보안 확인','Tailmance를 안전하게 계속 사용하려면 간단한 확인을 완료하세요.','확인 중…','확인되었습니다. Tailmance로 돌아갑니다…','확인을 시작할 수 없습니다. 이 페이지를 닫고 다시 시도하세요.','취소'],
 'zh-Hans':['安全验证','完成此快速验证，以安全继续使用 Tailmance。','正在验证…','验证成功。正在返回 Tailmance…','无法启动验证。请关闭此页面后重试。','取消'],
 'zh-Hant':['安全驗證','完成此快速驗證，以安全繼續使用 Tailmance。','正在驗證…','驗證成功。正在返回 Tailmance…','無法啟動驗證。請關閉此頁面後重試。','取消'],
 nl:['Beveiligingscontrole','Voltooi deze korte controle om Tailmance veilig te blijven gebruiken.','Controleren…','Geverifieerd. Terug naar Tailmance…','De controle kon niet starten. Sluit deze pagina en probeer opnieuw.','Annuleren'],
 pl:['Kontrola bezpieczeństwa','Ukończ tę krótką weryfikację, aby bezpiecznie korzystać z Tailmance.','Sprawdzanie…','Zweryfikowano. Powrót do Tailmance…','Nie udało się uruchomić weryfikacji. Zamknij stronę i spróbuj ponownie.','Anuluj'],
 th:['การตรวจสอบความปลอดภัย','ทำการตรวจสอบสั้น ๆ นี้ให้เสร็จเพื่อใช้งาน Tailmance ต่ออย่างปลอดภัย','กำลังตรวจสอบ…','ยืนยันแล้ว กำลังกลับไปที่ Tailmance…','ไม่สามารถเริ่มการตรวจสอบได้ ปิดหน้านี้แล้วลองอีกครั้ง','ยกเลิก'],
 vi:['Kiểm tra bảo mật','Hoàn tất bước xác minh nhanh này để tiếp tục sử dụng Tailmance an toàn.','Đang kiểm tra…','Đã xác minh. Đang quay lại Tailmance…','Không thể bắt đầu xác minh. Hãy đóng trang này và thử lại.','Hủy']
};
const c=copy[locale]||copy.en;
document.documentElement.lang=locale;
document.getElementById('title').textContent=c[0];document.getElementById('body').textContent=c[1];document.getElementById('cancel').textContent=c[5];
const status=document.getElementById('status');
const validState=/^[A-Za-z0-9_-]{32,128}$/.test(state);
const config=window.TAILMANCE_WEB_CONFIG||{};
const siteKey=String(config.authTurnstileSiteKey||'').trim();
function back(values){const u=new URL('tailmance://auth-challenge');u.searchParams.set('action',action);u.searchParams.set('state',state);for(const [k,v] of Object.entries(values))u.searchParams.set(k,v);location.href=u.toString()}
document.getElementById('cancel').addEventListener('click',()=>back({error:'cancelled'}));
if(!allowedActions.has(action)||!validState||siteKey.length<10){status.textContent=c[4];return}
status.textContent=c[2];
const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;
script.onload=()=>{if(!window.turnstile){status.textContent=c[4];return}window.turnstile.render('#turnstile',{sitekey:siteKey,action:`tailmance_${action}`,callback:(token)=>{if(typeof token!=='string'||token.length<20){status.textContent=c[4];return}status.textContent=c[3];back({token})},'error-callback':()=>{status.textContent=c[4]},'expired-callback':()=>{status.textContent=c[4]}})};
script.onerror=()=>{status.textContent=c[4]};document.head.appendChild(script);
})();
