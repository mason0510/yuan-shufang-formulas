## 赞助商：[ChainFuel](https://chainfuel.tap365.org/)

**ChainFuel 提供稳定、低价的大模型接口。** 在现有工具里填一把密钥和 Base URL，按 OpenAI 兼容方式调用 GPT、Claude、Grok、Gemini、GLM、Kimi、DeepSeek。

**注册福利：余额 2 刀 + 5 刀订阅体验。现在邀请新用户购买，赠送一个月订阅套餐。**

# 袁淑芳墓碑验方库

网站：https://mason0510.github.io/yuan-shufang-formulas/

河南西平县芦庙乡盘龙桥村老中医**袁淑芳**（行医八十余年）遗愿：将毕生精要验方刻于墓碑，供后人借鉴。

## 初心

袁淑芳把验方刻上墓碑，是要留给后来的人，不是锁在家里。我们接着做这件事：把碑方和各方交来的古方开源。开源属于全人类。

## 号召

这个库收未公开的民间古方：墓碑、家传抄本、地方抄本、口述、照片。目标是做成这一类里最大的开源库。已经出版、在公开古籍库里有稳定出处的成方，只记线索，不拿来充首数。倪海厦等今人著作只收书名、方名和页码。请把持有人、地点、载体和原文交到 [open-medical](https://mason0510.github.io/yuan-shufang-formulas/open-medical.html)。交来的内容单独入库，不自动写进这 120 首墓碑验方。

本仓库据墓碑照片誊录 + 公开电子版互校，整理为可检索、可程序化调用的开源验方数据，并附带可直接启动的开方智能体说明。

> **重要**：仅供专业辨证学习参考，**不可自行照方抓药**。家属强调碑方只是参考框架，须按体质加减。穿山甲等管控/禁用野生药材须换合法代用品并注明非原方。

## 本库收录

| 项目 | 说明 |
|------|------|
| 收录 | 120 首（碑称百首；立面四末段风化未补） |
| 分类 | 妊娠、产后、不孕、经带、儿科、内科、外科、五官 |
| 格式 | JSON + Markdown |
| 标记 | `ctrl` 管控药 / `doubt` 存疑（照片与电子版冲突或残缺） |

## 目录

```
data/formulas.json                 # 机器可读
data/formulas.md                   # 人类可读
data/sources/xhs-100fang/          # 小红书 22 张实拍誊录底本
agent/                             # 开方智能体：系统提示 + 启动说明
docs/disclaimer.md                 # 合规与使用边界
```

## 快速使用数据

```bash
# 按病证检索
jq '.formulas[] | select(.ind | contains("痛经"))' data/formulas.json
```

## 启动开方智能体

见 [`agent/README.md`](agent/README.md)。把 `agent/SYSTEM.md` 贴进任意支持自定义系统提示的对话模型即可开箱使用；或在 Grok Bot / Cursor 中导入同名 Agent。

## 现在怎么选方，和 RAG 的差别

现在的做法是整库注入。网页每次把 `docs/system.md` 里的 120 首全部放进系统提示词，只叫模型「选最贴证的 1～2 首」。程序不按证候打分，也不先取出少数几首再交给模型。程序唯一的判断是字面包含：用户原话里有没有某条病证或方名。有，就不查库外。没有，才把原话前 80 字交给摩熵，把返回的几条接在用户消息后面。无论哪种，模型仍然看着全部 120 首。

RAG 把方剂留在库里。主诉先去检索，只有排到前面的少数几首进入提示词，并留下可核对的命中依据。模型看不到整库。

方剂一多，整库注入就不能用：

- 上下文装不下。靠后的方被截掉或被漏看，选中的往往是排在前面的，不是最贴证的。
- 费用和等待随方数一起涨。一万首、十万首不能每次都塞进提示词。
- 编号和药味会串。模型可以选出和主诉无关的方，也可以写出该编号原文里没有的克数。
- 没有命中分。同一主诉两次可以选出不同编号，程序无法复核它为什么选这一首。
- 「孕吐」对不上「妊娠呕吐」；原话里偶然出现一个短病证，又会当成已经对上，库外不再查。

120 首目前还能塞进一次请求。民间方大量进来之后，必须改成先检索、再只注入命中的几首。现在这套不能当大方库的选方。细节见 [`agent/README.md`](agent/README.md)。

## 合规边界

- 不对外宣称「AI 医生」「在线处方」
- 输出为**参考方**，须由有资质医师把关后抓药
- 缺药时给出合法代用，不建议使用野生保护动物药

## 许可

数据整理与文档采用 [CC BY-NC-SA 4.0](LICENSE)。墓碑碑文内容属公开史料抄录；使用时请注明出处并遵守当地医药法规。

## 来源与致谢

- 墓碑所在：河南驻马店西平县芦庙乡盘龙桥村
- 媒体报道与家属访谈（大河报等）确认碑方为参考框架、须辨证加减
- 本库由照片 OCR/人工誊录与电子传抄互校而成，欢迎纠错 PR


## 在线智能体（GitHub Pages）

启用仓库 Pages（Source: Deploy from branch → `/docs`）。

在线地址形如：`https://mason0510.github.io/yuan-shufang-formulas/`

页面、Worker 和登录库怎么部署，见 [docs/DEPLOY.md](docs/DEPLOY.md)。

## Star History

[![GitHub stars](https://img.shields.io/github/stars/mason0510/yuan-shufang-formulas?style=social)](https://github.com/mason0510/yuan-shufang-formulas/stargazers)

![Star 累计](docs/star-history.svg)

曲线由 `python3 scripts/update_star_history.py <stargazers.tsv>` 重画。仓库里没有定时函数，不跑这句，图就停在上次写出的数字。
