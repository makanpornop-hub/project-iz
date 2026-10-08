import { betterAuth } from "better-auth";
import { username } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { db } from "./db";
function initializeAuth() {
  return betterAuth({
    database: db,
    plugins: [username()],
    baseURL: process.env.BETTER_AUTH_URL,
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        if (!process.env.SMTP_HOST) throw new Error("Почта не настроена");
        const mail = nodemailer.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_PORT === "465",
          ...(process.env.SMTP_USER
            ? {
                auth: {
                  user: process.env.SMTP_USER,
                  pass: process.env.SMTP_PASSWORD,
                },
              }
            : {}),
        });
        await mail.sendMail({
          from: process.env.MAIL_FROM,
          to: user.email,
          subject: "Project Iz — восстановление пароля",
          text: `Для установки пароля откройте ссылку: ${url}\nЕсли вы не запрашивали это письмо, проигнорируйте его.`,
        });
      },
    },
    session: {
      expiresIn: 60 * 60 * 12,
      updateAge: 60 * 60,
      cookieCache: { enabled: false },
    },
    rateLimit: { enabled: true, storage: "database" },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const { rows } = await db.query(
              "SELECT active FROM staff WHERE user_id=$1",
              [session.userId],
            );
            if (!rows[0]?.active) return false;
            return { data: session };
          },
        },
      },
    },
  });
}

const globalAuth = globalThis as unknown as {
  izAuth?: ReturnType<typeof initializeAuth>;
};
export function getAuth() {
  if (
    !process.env.BETTER_AUTH_SECRET ||
    process.env.BETTER_AUTH_SECRET.length < 32 ||
    !process.env.BETTER_AUTH_URL
  )
    throw new Error("Авторизация не настроена");
  return (globalAuth.izAuth ??= initializeAuth());
}
