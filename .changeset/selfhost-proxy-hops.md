---
"@semestra/api": major
---

<!-- area: self-hosting -->
<!-- en -->
Behind the bundled Caddy or another reverse proxy, set SEMESTRA_TRUSTED_PROXY_HOPS=1 so sign-in limits see the real client address; FORWARDED_ALLOW_IPS is no longer used.
<!-- zh -->
使用内置 Caddy 或其他反向代理时，请设置 SEMESTRA_TRUSTED_PROXY_HOPS=1，登录限流才能识别真实的客户端地址；不再使用 FORWARDED_ALLOW_IPS。
