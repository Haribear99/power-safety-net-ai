"use client";
// 법정 배너의 실제 높이를 --banner-h로 내보낸다. 배너는 글꼴·폭에 따라 두 줄이 될 수 있어(약 640~690px),
// 고정 높이(29px)에 맞춰 붙여 둔 /ops 상단 바·/lab 탭 바가 가려지던 문제를 막는다. 값이 없을 때(JS 전)는 각 화면의 29px 기본값을 쓴다.
import { useEffect } from "react";

export function BannerHeightSync() {
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('[data-testid="legal-banner"]');
    if (!el) return;
    const set = () => document.documentElement.style.setProperty("--banner-h", `${el.getBoundingClientRect().height}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return null;
}
