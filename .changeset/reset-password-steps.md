---
"@semestra/web": patch
"@semestra/api": patch
---

<!-- area: account -->
<!-- en -->
Resetting a password now checks the code first, so a password that doesn't meet the requirements can be changed without a new code.
<!-- zh -->
重置密码改为先验证验证码再设置新密码，新密码不符合要求时可直接修改，无需重新获取验证码。
