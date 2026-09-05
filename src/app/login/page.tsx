"use client";

import { useState, type FormEvent } from "react";

/**
 * 접근 제한이 켜졌을 때 보이는 잠금 화면.
 * 게이트가 꺼져 있으면 미들웨어가 여기로 보내지 않으므로 평소에는 노출되지 않는다.
 */
export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password.trim() || pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { ok?: boolean; notice?: string };
      if (data.ok) {
        const next = new URLSearchParams(window.location.search).get("next");
        // 오픈 리다이렉트를 막으려고 앱 내부 경로만 허용한다.
        window.location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
        return;
      }
      setNotice(data.notice ?? "확인에 실패했습니다.");
    } catch {
      setNotice("네트워크 오류로 확인하지 못했습니다.");
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-slate-100 p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-lg"
      >
        <h1 className="text-lg font-bold text-slate-950">누리맵</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          민간데이터가 포함되어 접근이 제한된 서비스입니다. 배포된 접근 비밀번호를 입력해 주세요.
        </p>
        <label htmlFor="access-password" className="mt-5 block text-sm font-bold text-slate-700">
          접근 비밀번호
        </label>
        <input
          id="access-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 px-3 text-sm"
        />
        {notice ? (
          <p role="alert" className="mt-2 text-sm font-medium text-rose-600">
            {notice}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="mt-5 h-11 w-full rounded-xl bg-blue-600 text-sm font-bold text-white disabled:opacity-60"
        >
          {pending ? "확인 중…" : "들어가기"}
        </button>
      </form>
    </main>
  );
}
