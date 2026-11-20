> 来源：profitbridge-batch11/tmp-batch11/REPORT.md（2026-11-20 归档）

# batch11 入库报告（CSCO / 00700.HK / 00992.HK / 01024.HK）

- 执行时间：2026-11-19 22:15–22:35 (+08:00)
- 仓库：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge`（main 未动，HEAD 仍为 `73fe120`）
- 工作树：`C:\Users\Dao\Code\dao1023\dsh-temp\profitbridge-batch11`
- 分支：`data/batch11-20261119`
- 复核来源：`tmp-verify-20261119/REPORT.md`（+ `verified.json`）
- 结论：**4 行全部写入成功；未 push、未 rebase、未改 main；测试 21/21；幂等 added=0。01024.HK 桑基图不崩、控制台无报错，但“毛利→营业利润为负”的分支实际不可见（前端 `buildGraph` 只在 `opInc >= 0` 时生成营业利润节点），详见 §7。**

## 1. 写入的 4 行（数值未改动）

| ticker | name | currency | report_type | notice_date | end | 关键数值 |
| --- | --- | --- | --- | --- | --- | --- |
| CSCO | CISCO SYSTEMS, INC. | USD-M | 10-Q | 2026-11-17 | 2026-10-24 | rev 18,517 / gross 11,788 / op 5,598 / NI 4,552 / rd 2,423 / tax 943 |
| 00700.HK | Tencent | CNY-M | 2026年三季报 | null（staging 原值；不进入 quarter 行） | 2026-09-30 | rev 207,336 / gross 115,911 / op 59,147 / NI 63,612 / sga 56,221 |
| 00992.HK | Lenovo | USD-M | 2027年中报 | null（staging 原值；不进入 quarter 行） | 2026-09-30 | rev 30,238 / gross 4,840.87 / op −117.08 / NI −639.86 / rd 793.99 / sga 1,995.52 |
| 01024.HK | Kuaishou | CNY-M | 2026年三季报 | null（staging 原值；不进入 quarter 行） | 2026-09-30 | rev 31,592 / gross 15,216 / op −635 / NI −961 / rd 5,178 / sga 11,049 |

- 新建 `data/staging/batch11.json`：`_meta`（batch/generatedAt=2026-11-19/sources 指向 `tmp-verify-20261119/REPORT.md`、口径、shape、keyNote、riskNote）+ `results` 4 家 + `enrich: []`。
- 合并命令（增量非破坏，无 `--force`）：
  - `node scripts/merge_batches.mjs --batch-only=batch11`
  - 首次结果：`totalCompanies=92 totalQuarters=3727 added=4 guardFails={} skipped=[]`
  - integrity gate **未拦截**（4 家 gross 均为正；无 `NEG_GROSS_OK8` 白名单需求，脚本未改）。
- merge report：`tmp-merge/merge_report.json`（被 .gitignore 忽略，仅本地产物）。

## 2. 镜像 deepEqual

`data/profit.json.js` 剥掉前缀 `window.__PROFIT_DATA = ` 与结尾 `;\n` 后 `JSON.parse`，与 `data/profit.json` 做 deepEqual：

```
mirror deepEqual: true
```

（同时校验收尾格式 `;\n` 存在；脚本 `tmp-batch11/verify.mjs` 可重跑。）

## 3. 逐公司 diff 总览

基准：`git show 73fe120:data/profit.json`（data commit 的父提交）。新增 **恰好 4 行**，4 个 ticker 各 1 期；**changed=0 / removed=0**；其余 **88/92** 家原始文本块逐字节相同。

| ticker | 期数 before → after | added | changed | removed | metaChanged |
| --- | --- | ---: | ---: | ---: | --- |
| CSCO | 72 → 73 | 1 (2026-10-24) | 0 | 0 | false |
| 00700.HK | 94 → 95 | 1 (2026-09-30) | 0 | 0 | false |
| 00992.HK | 17 → 18 | 1 (2026-09-30) | 0 | 0 | false |
| 01024.HK | 28 → 29 | 1 (2026-09-30) | 0 | 0 | false |
| 其余 88 家 | 不变 | 0 | 0 | 0 | false |

期数：**3723 → 3727（+4）**；公司数：**92 → 92（不变）**；`profit.updated` = `2026-11-19`。

## 4. 键集合核对（逐家，与既有最近一期同构）

| ticker | 新行键序 | 前一期键序 | 一致 |
| --- | --- | --- | --- |
| CSCO | `end,revenue,gross,opInc,netInc,rd,tax`（7） | 同左 | 是 |
| 00700.HK | `end,revenue,netInc,periodType,fxToUsd,gross,opInc,sga`（8） | 同左 | 是 |
| 00992.HK | `end,revenue,netInc,periodType,gross,opInc,rd,sga`（8） | 同左 | 是 |
| 01024.HK | `end,revenue,netInc,periodType,fxToUsd,gross,opInc,rd,sga`（9） | 同左 | 是 |

- CSCO 无 `periodType/fxToUsd/sga`；其余三家无 `tax`；00992.HK 无 `fxToUsd`；腾讯无 `rd`。缺键整条省略，无 `null` 占位（`notice_date: null` 是 staging 元数据，不写进 quarter 行）。
- 每家新行完整 JSON 见 §5 证据原文。

## 5. 证据表（自动生成原文）

### 5.1 新增 4 行的完整 JSON 与键集合核对

### CSCO (CISCO SYSTEMS, INC., USD-M, n=73)

新行 `2026-10-24`：

```json
{
  "end": "2026-10-24",
  "revenue": 18517,
  "gross": 11788,
  "opInc": 5598,
  "netInc": 4552,
  "rd": 2423,
  "tax": 943
}
```

- 新行键序（7）：`end,revenue,gross,opInc,netInc,rd,tax`
- 前一期 `2026-07-25` 键序（7）：`end,revenue,gross,opInc,netInc,rd,tax`
- 键集/键序一致：**是**
- 新行在原文件中的位置：index 72（倒数第 1 期）

### 00700.HK (Tencent, CNY-M, n=95)

新行 `2026-09-30`：

```json
{
  "end": "2026-09-30",
  "revenue": 207336,
  "netInc": 63612,
  "periodType": "q3",
  "fxToUsd": 0.14915355,
  "gross": 115911,
  "opInc": 59147,
  "sga": 56221
}
```

- 新行键序（8）：`end,revenue,netInc,periodType,fxToUsd,gross,opInc,sga`
- 前一期 `2026-06-30` 键序（8）：`end,revenue,netInc,periodType,fxToUsd,gross,opInc,sga`
- 键集/键序一致：**是**
- 新行在原文件中的位置：index 94（倒数第 1 期）

### 00992.HK (Lenovo, USD-M, n=18)

新行 `2026-09-30`：

```json
{
  "end": "2026-09-30",
  "revenue": 30238,
  "netInc": -639.86,
  "periodType": "q2",
  "gross": 4840.87,
  "opInc": -117.08,
  "rd": 793.99,
  "sga": 1995.52
}
```

- 新行键序（8）：`end,revenue,netInc,periodType,gross,opInc,rd,sga`
- 前一期 `2026-06-30` 键序（8）：`end,revenue,netInc,periodType,gross,opInc,rd,sga`
- 键集/键序一致：**是**
- 新行在原文件中的位置：index 17（倒数第 1 期）

### 01024.HK (Kuaishou, CNY-M, n=29)

新行 `2026-09-30`：

```json
{
  "end": "2026-09-30",
  "revenue": 31592,
  "netInc": -961,
  "periodType": "q3",
  "fxToUsd": 0.14915355,
  "gross": 15216,
  "opInc": -635,
  "rd": 5178,
  "sga": 11049
}
```

- 新行键序（9）：`end,revenue,netInc,periodType,fxToUsd,gross,opInc,rd,sga`
- 前一期 `2026-06-30` 键序（9）：`end,revenue,netInc,periodType,fxToUsd,gross,opInc,rd,sga`
- 键集/键序一致：**是**
- 新行在原文件中的位置：index 28（倒数第 1 期）

### 5.2 期数/公司数

| 项 | 基准 `73fe120:data/profit.json` | 合并后 | 变化 |
| --- | ---: | ---: | ---: |
| 公司数 | 92 | 92 | 0 |
| 总期数 | 3723 | 3727 | +4 |

### 5.3 逐公司 diff（对应 `tmp-batch11/verify.json`）

| ticker | 期数 before → after | added | changed | removed | metaChanged |
| --- | --- | ---: | ---: | ---: | --- |
| CSCO | 72 → 73 | 1 | 0 | 0 | false |
| 00700.HK | 94 → 95 | 1 | 0 | 0 | false |
| 00992.HK | 17 → 18 | 1 | 0 | 0 | false |
| 01024.HK | 28 → 29 | 1 | 0 | 0 | false |
| 其余 88 家 | 不变 | 0 | 0 | 0 | false |

`changedCompanies` 全部为 `changedQ=[] / removedQ=[] / metaChanged=false`；`unchanged=88`。

### 5.4 88 家未变公司「原始文本块」sha256

口径：在 `data/profit.json` 原文中按 `"<ticker>": { … }` 花括号切出每家 entry 的**原始字节**（保留缩进/换行），分别对 `73fe120` 与合并后文件求 sha256。

| ticker | n | sha256 (before = after) |
| --- | ---: | --- |
| NVDA | 65 | `8fb461742b8182af1bd15a0f77b3eb8fcd3407d2436cd259151ee7c9d3cbe620` |
| AAPL | 72 | `c5a2386c08bd411a8668196f79652832b8ebe2150386a6cab94d358c189f5419` |
| MSFT | 77 | `9c678f1bb925ec6c656faf39fd88a4c7b6e7406bf3465bd901d67834a9263cd4` |
| AMZN | 71 | `b73104b158b33db2ade710d2fac2ffaa8f8d075db6bbbddf3939d15c3556bc2b` |
| TSLA | 67 | `bf5d5447ade47f7f0b262f5070408a7a35218968a9b5f99ba51b8daf83117d9b` |
| INTC | 71 | `29682a56e2f604ae43f3f88eac4c4120ebdf8535ffd1c14b9683d39e3911c9b5` |
| MU | 68 | `3e0540cd21a1bb96ae8fff8d6a76ca19587f120a178e63aae7858ca04b6e1a1b` |
| V | 72 | `b06d596ba804e1ab3c3fa3773ffe30e72a459832580ad09c50d6a12628d21fff` |
| KO | 35 | `3d8277c34cc04eafd6c230c0e518d45787baeeaa43ea192073be162a6355d687` |
| NFLX | 71 | `29ee334b21efbf4472ce8d5c1d0dd068b3825187ee624b366b2172b54b60d3fc` |
| IBM | 71 | `066b3535ae974449d9d4cdbfaf9d6398508bd9faef156b11bd2463e514218153` |
| QCOM | 72 | `d08ac9d98224dbfbce761e49b4c3a9150a1a575c761f3b8f305fdf32180f504b` |
| MCD | 71 | `198d82b0a16d78543c21343da5aaacbf484d7377b77bfeffdeb6fd17636bb55f` |
| SBUX | 72 | `8c1bbb7c5302040547c5687c53a6fd520bdac2086e7d3d578fca7323e8c332a8` |
| ADBE | 71 | `ba2b293242beaa01ca8f0a23bd91e60a49c243aa256b7f580ded3740272dff11` |
| MSI | 65 | `f1857e7f08d0891f55cbed7cba60829134b7a3f30ffbc53dd383a5d004e14492` |
| NXPI | 31 | `51e631db4184faa8c3e895fd6880929d01cdf5c215a19e43a9b7dffcdd3730ab` |
| GOOGL | 47 | `b9703a968be9708b97c291ad67736058feee154e04fab29cb7f0179ee91d3143` |
| META | 59 | `30e2e7e145f07d021d26dcb4cfc4bc9d55adf5d956b8939fa53cc10cbbf29e92` |
| ORCL | 61 | `f99f3e7c9530eeb9bae3b1f9826d0cf0c23b3a1cc0b69e29bd29af6295099b9a` |
| AMD | 59 | `3386765b0bc6dbf55c927a9b205d3ea141141dad58796ca2550f4b48a971fcd3` |
| AVGO | 39 | `83ab1607b2648972f92708227f4d91b3d3515f51ff1f5e40bfc9a7ce6b0fecb9` |
| PLTR | 27 | `87394da7849a2b325e4fd35441ed3d8be8037c5cae388859f37222fcfba52b2a` |
| DELL | 46 | `18a39ed2075d3d9bbed4f876e4ad0a02b51ff2ac766ed20fe1aaac4b8a6e66c0` |
| HPQ | 47 | `8b5ea516bcb79868db73dce2953abd2f7ab820dc3450a6a709a6ef34597ff24a` |
| U | 27 | `67d46045f226c5d5b252f9d5ffbc796b15c8faafa47dd40d73ccb0e8d524860d` |
| DUOL | 23 | `e7c5cbe136cbecccfff3d1afda591f279e258c4750cd784482137866b00908b5` |
| ARM | 18 | `67da52458755d153b776b17555890a0d09f4142407235059544179642b42ee23` |
| SPOT | 25 | `9f74b30916fa4b5cb41aa33816b81446a850df539da4eb466d4cdb77ffe48322` |
| STM | 35 | `fd57b7cf45dc963f33a75396373104fc187e339a32e7bf0c90577e741d0feb26` |
| TSM | 26 | `4460e7979f2e034b7231906571f18a7dc7a9d02c5ad868620fbeb17e30872235` |
| ASML | 34 | `ecb12d80869d2f796ec81dae479430775f96e50bab8433d8c834d2431891b06a` |
| SONY | 34 | `4865e8929aa9a8b2a6b7bb1635e725be3f04209ac119cf00e294f02f312c3f53` |
| BABA | 29 | `e5e32e74ef500fae1e4bab720c4613330563ec9514cd8a0b79e71595f26578cc` |
| BIDU | 34 | `2f9239f9ecd27fd098ff80b83e7de6290a8443a1972db3ddf398d6fca2a4e174` |
| TCOM | 33 | `59b787d48ccc062c75d1f095d7a94439c412c42c6626ea595dfe294b528e3ccf` |
| JD | 29 | `6efd6d56b6a38d1bccdc0399de7d30ed1dbb6b67fb3306b93c4f5a45a5948dc5` |
| PDD | 25 | `13149efcf5369509558ce04acd35e76c0cfea5356995b4d303066f80314286b1` |
| LI | 20 | `c13c8e4f1740e3298ca1c469b97992d75a3eb5c55f36bfe5e17aab16364f2a43` |
| BILI | 20 | `78bbce3abc2363bdd1318d2f1ca6278a6d65d92282ee08f4656fdbb41addc180` |
| WB | 29 | `a3111047b6f2c33b77dd952b2649f0295fe6d3a01276e13c6a681b4c1ac373e8` |
| ZH | 20 | `d95cab7425ef6d5b33cd6bdf0d12962a08cd590cc08636f3419f25063fefea8c` |
| XNET | 29 | `596d6a055c797f4e8520e2961989829eb2b9d8e5f40f4d32f48afba887f29427` |
| TME | 25 | `a8d6a97059e13e460e81b1cffe38793d2824c38c8283acb5829d02698c6083ab` |
| LKNCY | 23 | `d38fff8c4db2e0f06a9becbfc4240008ae782ee70bd9c3208b06796cb3edbed7` |
| CRWV | 11 | `ff0463070a81b51d5d112ceecdfcdfbfc17edb95da989a5c66c9369362252f58` |
| DIDIY | 22 | `6dbd3861934c36d2d8a6494ac876b2c7fef8c61015588f118714e4ef280b615c` |
| 00941.HK | 23 | `0c53b334bb2f22abc40b9fa278af06e34206b59e6712876ed494ac0f5bdade96` |
| 01398.HK | 81 | `c354c3a76c146d65d244412325ce70c7becd155b47343042b1fdeac6adb17f1c` |
| 03968.HK | 59 | `c0a94aa82404d252eddf2f6627552cca0b0909195437107cc983ece6bc1912d4` |
| 03690.HK | 36 | `146fddf7ceaf10f446f6db790824d2bd94feefea01b39f79461d7d09e598adb7` |
| 00728.HK | 49 | `7c5adbde7bcd91d90bec244ed6510bf875a9eff12e49c00b8864f544df3d9b5c` |
| 00981.HK | 81 | `2989af04e8d970b85152efdeaf0cb0abdf53c58c9783e978af1686c2e7bede05` |
| 00762.HK | 71 | `2318fcb9377d6cea28877d73b3f686aa7c4435c211e450685353dccb7fd49fa9` |
| 03888.HK | 54 | `b327eef4609b2cd57e4d438d954c523ae3485aa2f81afa6347b841ddb5a0c721` |
| 005930.KS | 20 | `b34e5c6030029c2d7f69f4dc9db22efeaad5f74d4c9f51416774dd2ebdb85769` |
| 000660.KS | 20 | `b0c7071c516358c39d4d994dcc8a74a0c010d22bebb0e17a1e2533fd1e18693a` |
| 066570.KS | 20 | `a457fb16c173d3b13732af4c86dc867f6febbfea9a741912ae73bf07bf3376f6` |
| 600519.SS | 67 | `f921267304e010981b8b8cbce02b515a20ededff5542efc1fdeda3e3fc7aebdc` |
| 300750.SZ | 39 | `cdf7a2da8462a2fff07af491a1ae883e583350e439ccd2e56f3f1e8584d9e128` |
| 002594.SZ | 67 | `58bdb719f416d4468bad5237d7e2fda77e63a5ee8e334b5e7020685d719d026b` |
| 688256.SS | 31 | `401b01e5850a342a443fd4d8882146437eb280454a87313a9a6397ba758b9fc4` |
| 688795.SS | 8 | `c51f4b6645a8c2ba6acdf20065ba258adea4792cefec73b35ddd395d63e7a350` |
| 002415.SZ | 67 | `aa7f1f882fefe31a9b93cf241b174b202316c9af79f1e6ba189346cf2ddab692` |
| 000063.SZ | 67 | `d961fd84917fcc1ee00e5e5b2022709368e5e493b8268d8c8e80025fa8e4173b` |
| 000333.SZ | 67 | `749d5bc8079dd24d6be6baaf80764b34d678cef60904d3bd8b438ec2d6e69d24` |
| 000100.SZ | 67 | `bdffc8154fa840e826c6dd22eeae45adc14f4f0678e23fd6c9c03992404cac00` |
| 601360.SS | 39 | `7f8e7a9e29051bf0e2940d3435c98cb9c97e25304a14125ef864c3fbf717e8a6` |
| 688825.SS | 8 | `983a8859c044f4d414211eccd742bcf1aee00323c6ff52e1a8b5a00b0d887a2d` |
| 600887.SS | 67 | `80664da3637148ffe74394953c81cb427d348ae8e24e3022369998a34015d6f1` |
| 688981.SS | 31 | `98e09d215ba1628c16808d61fb9a4ba52d1ee1854755cb065074a73fc61376d5` |
| NESN.SW | 11 | `199b4e222a71b817797e0c6aaeacff6111bb645b9d2da88312607b038f054b04` |
| MC.PA | 11 | `19cb1ca6e07d77e3851fe365bd6be56a81273e6d065cece51c31a0df64ec1689` |
| 2454.TW | 14 | `70be725305c3fb341c9b63bb9109da24d4106f2e81185e669f7006d11e44fbc2` |
| 2330.TW | 15 | `f460323bb5e2541551f91aba12f4703116644b8f64258f691f5d5a18bc5d1649` |
| SPCX | 2 | `31dc86107324ad43ce6d53c34811848dd8277f0b759d30057e171b2f9cacce92` |
| NTES | 33 | `fa2bb8a32071162e928c5c1f43cafc34f62589d7e3ccf277a5f1a4b1913b38fd` |
| CHA | 15 | `dc0845e1be87936576322954ec0d5de79b4ae8f9a2fa2eb72b66630ab29af765` |
| CBRS | 5 | `5cfdb27428cc1d3cebf340a2a76e89b1005cfae4e95efa0c39ac01a97844cb58` |
| HUAWEI | 7 | `2263353a760dffa22ea1b0abfe1efd735479c18310c1b2fddad897b0896786bd` |
| LEGO | 7 | `a2dc256ce69e992738633481cab721ad5d68d1ea073f7aa262a0991510ade95f` |
| 02513.HK | 7 | `160762b0cb0c8769e84d909cb49fee7015901620824aded92d49603cf29b9bda` |
| 00100.HK | 8 | `a0cdf21ae93b46036b0452b6e490b60cfe21f6d544fd1c7e36cec7d7ce07e9bc` |
| 02097.HK | 11 | `a0b6f6d19465f7fff773abc640d930efe8df99360628cefe6aaaa7722de788b7` |
| 00151.HK | 44 | `8cc2a12fe2619e8eb875834e320ab7f51384470debc75b4aa04df1587c76d659` |
| 09633.HK | 17 | `cd5ea2f99d1691edaaacee75b7ea4a545030c9423d84520b5f277a4d15ad07a3` |
| 01810.HK | 40 | `2cb94eaf004599dd1f0ff4b4043dd01907f4cf48077d259a238b671350c7c76c` |
| 603866.SH | 48 | `862342dfd9fba829a7bc28924cb7bbcdd4d90291b220e0b3288aaccdfab56985` |

88/88 原始字节块相同：**true**（`88/92`；不同的恰好是 4 个目标 ticker）。

#### 4 个目标公司（整条 entry 必然变化）

| ticker | n before → after | sha256 before | sha256 after |
| --- | --- | --- | --- |
| CSCO | 72 → 73 | `1615e8e9a0abd6ccde4305a5e4afbc6a7c784b6cccfe061ca77e0778c1e15ca0` | `b469ff6f219124940891428b8e8709eefc6018829fa35a0533856d04e3e2f8fb` |
| 00700.HK | 94 → 95 | `5ff1c64f9b0225b8128e67a1e0e735204ffbf73a2cc057f57bb03df33c6b73f5` | `2714e410a14884fb4614cc025e07e71629db66903e88e6bcc2e2baf7bfddd3eb` |
| 00992.HK | 17 → 18 | `91c242b7ffc269ca498705da5adb3d1c82d2345c1fa232d8e2676d98185424fb` | `95c87fc5f3aaa690ac77a75c42bd28badff7f907ba461b31bf2470b0b700411e` |
| 01024.HK | 28 → 29 | `c22edbdf997f539f94c36a183ee34b666b900b5519b775a6274e9b7f70ffdd49` | `baa3f468b96f8c6c8c4243dff09ebdf7e57a34b50385473a3818b3ab7e4a9533` |

## 6. 测试结果（8440 起服务后跑，跑完已停服）

- 启动：`node scripts/serve.mjs 8440`（后台），确认 `http://127.0.0.1:8440/` 可访问。
- 命令：`for f in tests/verify_*.mjs; do node "$f"; done`，其中 `verify_scan.mjs` 按约定单跑 `node tests/verify_scan.mjs --run`。
- **最终：21/21 PASS，0 FAIL**（`tmp-batch11/test-summary.txt`；逐测试日志在 `tmp-batch11/testlogs/`）。

```
PASS verify_bar
PASS verify_bar_basis_labels
PASS verify_bar_cum_growth
PASS verify_bar_lines
PASS verify_cum_seg
PASS verify_currency
PASS verify_export
PASS verify_filter_jitter
PASS verify_header_layout
PASS verify_layout_refactor
PASS verify_modes
PASS verify_new
PASS verify_pct_fix
PASS verify_scan
PASS verify_seg_annual_quarters
PASS verify_seg_axis
PASS verify_seg_notes
PASS verify_state_memory
PASS verify_timeline2
PASS verify_timeline_click
PASS verify_units_guard
-----
TOTAL pass=21 fail=0
```

### 6.1 测试断言过期与单独 test commit

首次跑（data commit 之后、test commit 之前）：**20 PASS / 1 FAIL**，失败为 `verify_new.mjs` 的 2 条硬编码期数断言（同类场景先例：`verify_new` 曾在 CBRS/NXPI 补期后同步过期）：

```
FAIL Tencent 94 single quarters with fx
FAIL Lenovo 17 quarters (got 18)
```

按“data commit 不改测试”的要求，先提交 data commit，再单独提交 `9c55e94` 更新断言（仅改 `tests/verify_new.mjs` 的 4 行（2 条注释 + 2 条断言；diff +4/−3））：

- 第 58 行：`00700.HK` 期数 `94 → 95`，断言文案 `Tencent 94 → 95 single quarters with fx`；理由：batch11 补入 2026-09-30 单季。
- 第 85–86 行：`00992.HK` 期数 `17 → 18`，断言文案 `Lenovo 17 → 18 quarters`；理由：batch11 补入 2026-09-30 中报单季。
- 未改任何其他断言、未放宽容差、未改数据。

test commit 后重跑全套：**21/21 PASS**。

## 7. headless 截图与 01024.HK 负值分支重点核验

设备：Chrome `--headless=new`，`Emulation.setDeviceMetricsOverride` 1600×1000，DPR=1，服务 `http://127.0.0.1:8440`。截图（工作树内，已被 .gitignore 忽略，仅本地）：

- `tmp-batch11/shots/CSCO.png`
- `tmp-batch11/shots/00700.HK.png`
- `tmp-batch11/shots/00992.HK.png`
- `tmp-batch11/shots/01024.HK.png`
- 机器可读元数据：`tmp-batch11/shots/meta.json`（title / 节点 / 边 / consoleErrors / logErrors）

| ticker | 页面标题 | SVG path 数 | 节点/边 | consoleErrors | 结论 |
| --- | --- | ---: | --- | ---: | --- |
| CSCO | 思科 Q4 2026 | 28 | 7 节点 / 6 边 | 0 | 完整：营收→毛利/成本→营业利润→净利/税费 |
| 00700.HK | 腾讯控股 Q3 2026 | 28 | 7 节点 / 6 边 | 0 | 完整：含非经营性收益支路 |
| 00992.HK | 联想集团 Q3 2026 | 12 | 3 节点 / 2 边 | 0 | **止于毛利**：opInc −117.08、netInc −639.86 未渲染 |
| 01024.HK | 快手 Q3 2026 | 12 | 3 节点 / 2 边 | 0 | **止于毛利**：opInc −635、netInc −961 未渲染 |

### 01024.HK（本批重点）现象

- **图形不崩**：SVG 正常渲染（12 条 path），标题“快手 Q3 2026”、顶部“数据更新：2026-11-19”、左侧“当前季度无分部披露”提示均正常；无 JS 异常。
- **控制台无报错**：`Runtime.exceptionThrown` = 0，`console.error` = 0（该页 `Log.entryAdded` 也无 error）。
- **“毛利→营业利润为负”的分支不可见**：实际只有
  - `营收 → 毛利润 15.216`
  - `营收 → 营收成本 16.376`
  两条边；`营业利润 −0.635`、`净利润 −0.961`（$B）完全没有节点/边，也没有“经营亏损/净亏损”标签。
- 根因（前端既有逻辑，本次未改）：`app.js:591` 明确注释 “All values non-negative”；`app.js:628` 只有 `if (op != null && op >= 0 && op <= gross)` 才创建 `op` 节点与 `gross→op` 边；`app.js:662` 又要求 `op > 0` 才接净利润。因此 `opInc < 0` 时瀑布在毛利处截断，负值被静默丢弃，而不是画成负向/亏损支路。ECharts sankey 本身不支持负值 link，需要单独建“亏损”节点（例如 gross → opLoss 取绝对值、红色标签）才能“可见”。
- **00992.HK 同样中招**（opInc −117.08、netInc −639.86，3 节点/2 边），说明这不是 01024 独有，而是“负 opInc”统一路径。
- 结论：任务期望的“负值分支可见”**未达成**；但“图形不崩、控制台无报错”**达成**。这是前端渲染缺口（数据本身已正确写入，见 §1 的 01024 行），修复需改 `app.js` 的 `buildGraph` 并补 UI/导出测试，超出本次“只写数据”的范围，建议单独开前端任务。未在本分支改 `app.js`。

其他观察（非本批引入）：CSCO 标题按日历季度显示 “Q4 2026”，而其财年为 FY2027 Q1（end 2026-10-24）；这是既有的 `quarterLabel` 日历口径，数据行与图表数值均正确。首次加载有一条 `/favicon.ico` 的 404（浏览器自动请求，服务器无该文件），不是 JS/图表错误，控制台 error 为 0。

## 8. 幂等

- data commit 后重跑：`node scripts/merge_batches.mjs --batch-only=batch11` → `added=0 guardFails={} skipped=[]`，`git status --porcelain` 为空。
- test commit 后再次重跑（最终态）：`added=0`，`totalQuarters=3727`，`git status --porcelain` 仍为空。
- 日志：`tmp-batch11/idempotency.log`。

## 9. 提交与仓库状态

| commit | 类型 | 内容 |
| --- | --- | --- |
| `36e1a3f` | data | `data(profit): 补 4 家 2026 Q3/中报新期（CSCO/00700/00992/01024，batch11）`（`data/profit.json`、`data/profit.json.js`、`data/staging/batch11.json`） |
| `9c55e94` | test | `test(verify_new): 腾讯 94→95 期、联想 17→18 期（batch11 数据前移同步）`（仅 `tests/verify_new.mjs`） |

- 分支 `data/batch11-20261119` 基于 `73fe120`，领先 main 2 个 commit。
- **未 push、未 rebase、未改 main**（main 仍 `73fe120`）。
- `git status --porcelain` 最终为空（`tmp-batch11/`、`tmp-merge/` 均被 .gitignore 忽略）。
- 未使用 `--force`；未改 `scripts/merge_batches.mjs` 白名单；未在 data commit 中改测试。

## 10. 遇到的问题汇总

1. `verify_new.mjs` 2 条期数断言过期 → 已按约定用独立 test commit 修正（§6.1）。
2. 01024/00992 负 opInc 分支不渲染 → 前端既有缺口，未修（超出数据入库范围），已在 §7 记录根因与建议。
3. 截图脚本首版只改 URL hash 导航，SPA 未重新加载导致 4 张图都是 CSCO；改为带 cache-busting query 的整页导航后重拍（仅工具问题，不影响产品）。
4. 本批 integrity gate 未触发；4 家 gross 均为正，无需白名单。
