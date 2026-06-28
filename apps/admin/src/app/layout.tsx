import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { Providers } from './providers';
import { AdminNav } from './admin-nav';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'BidiRide Admin',
  description: 'BidiRide Command Center',
  robots: 'noindex, nofollow',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const hasSession = cookieStore.has('admin_session');

  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans bg-navy-950 text-white antialiased`}>
        <Providers>
          {hasSession && <AdminNav />}
          <main className={hasSession ? 'pl-56' : ''}>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
