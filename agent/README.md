# 开方智能体（启动即用）

## 方式 A：任意 Chat / Claude / GPT

1. 新建对话，把 [`SYSTEM.md`](SYSTEM.md) 全文设为系统提示（或第一条消息）。
2. 用户发送：主诉 + 体质 + 药房清单。
3. 助手按碑方编号开出加减参考方。

## 方式 B：Grok Bot

侧边栏打开已创建的「中医袁淑芳」Agent，直接发病人情况即可（系统说明与验方库已写入人设）。

## 方式 C：本地脚本（可选）

```bash
# 需要本机已配置 OPENAI_API_KEY 或兼容接口
export SYSTEM_PROMPT="$(cat agent/SYSTEM.md)"
# 再调用你常用的 CLI / SDK，把 SYSTEM_PROMPT 当作 system
```

## 库外方剂

碑方对不上时，网页会先请求 `POST /v1/formulas/external`（摩熵数科中医药方剂，约 10 万首）。密钥只放 Worker secret `BCPM_API_KEY`，不进浏览器。未接通或检索为空时，仍然不准编药名和克数。

开通：<https://open.bcpmdata.com/api/163.html>  
写入：`cd backend && npx wrangler secret put BCPM_API_KEY`

## 最小问诊字段

- 年龄、性别、主诉与病程
- 体质：胖/瘦、怕冷/怕热、痰湿、气郁等
- 月经/白带/胎产史（妇科相关时）
- 药房现有药（没有则按常见饮片库，并标「请对照库存」）
