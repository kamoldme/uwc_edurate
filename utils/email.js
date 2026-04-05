const { Resend } = require('resend');

let resend;
function getResend() {
  if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
  return resend;
}

async function sendVerificationCode(email, code) {
  const html = `
    <div style="font-family:'Inter',Arial,sans-serif;max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:linear-gradient(135deg,#1e3a5f,#2563eb);padding:32px;text-align:center">
        <h1 style="color:#fff;margin:0;font-size:1.8rem;letter-spacing:-1px">Oasis</h1>
        <p style="color:#93c5fd;margin:8px 0 0;font-size:0.9rem">Email Verification</p>
      </div>
      <div style="padding:32px">
        <p style="color:#334155;font-size:1rem;margin:0 0 24px">Enter this code to verify your email and complete registration:</p>
        <div style="background:#f1f5f9;border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:2.5rem;font-weight:700;letter-spacing:8px;color:#1e293b">${code}</span>
        </div>
        <p style="color:#64748b;font-size:0.85rem;margin:0 0 8px">This code expires in <strong>10 minutes</strong>.</p>
        <p style="color:#94a3b8;font-size:0.8rem;margin:0">If you didn't request this, you can safely ignore this email.</p>
      </div>
      <div style="background:#f8fafc;padding:16px;text-align:center;border-top:1px solid #e2e8f0">
        <p style="color:#94a3b8;font-size:0.75rem;margin:0">&copy; 2026 Oasis. UWC Dilijan Feedback Platform.</p>
      </div>
    </div>
  `;

  const { error } = await getResend().emails.send({
    from: 'Oasis <noreply@oasis.uwcdilijan.am>',
    to: email,
    subject: `${code} - Your Oasis Verification Code`,
    html
  });

  if (error) {
    throw new Error(error.message);
  }
}

module.exports = { sendVerificationCode };
