import React from "react";
import { Pickaxe } from "lucide-react";

export function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F5F2] dark:bg-[#13151A]">
      <div className="card max-w-sm w-full mx-4 text-center space-y-6 py-10">
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-2xl bg-[#5B9BF0]/10 flex items-center justify-center">
            <Pickaxe className="w-8 h-8 text-[#5B9BF0]" />
          </div>
        </div>

        <div>
          <h1 className="text-xl font-bold text-[#1C1E27] dark:text-[#EAECF0]">
            redstoneCipher
          </h1>
          <p className="mt-1 text-sm text-[#6B6E78] dark:text-[#9BA0B0]">
            Sign in to manage your Minecraft server
          </p>
        </div>

        <a
          href="/auth/login"
          className="btn-primary w-full flex items-center justify-center gap-2"
          aria-label="Sign in with Google"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </a>

        <p className="text-xs text-[#9B9EA6] dark:text-[#626878]">
          Access is restricted. You must be invited by an admin.
        </p>
      </div>
    </div>
  );
}
