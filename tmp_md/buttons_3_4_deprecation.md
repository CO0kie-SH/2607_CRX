# 按钮3和按钮4弃用说明

封版版本：`26.7.4A`

## 当前状态

`chrome-extension/popup.html` 中的功能区按钮3和按钮4已经禁止点击：

- 按钮3：`抓取IP信息`
- 按钮4：`提取地址`

这次只禁用了 popup UI 入口，没有删除已有功能代码。

## 保留的功能代码

按钮3和按钮4对应的 JavaScript 分支仍保留在：

```text
chrome-extension/popup.js
```

主要逻辑包括：

- 按钮3分支：打开或刷新 `https://ipinfo.dkly.net/`，提取页面文本，上传到 `/api/html/text`，解析并保存 `country / region_name / city`。
- 按钮4分支：读取按钮3或按钮7保存的 IP/city 信息，调用 `/api/address/from-city`，生成地址、姓名和 Luhn 测试卡。

后端接口也未删除：

```text
POST /api/html/text
POST /api/address/from-city
```

## 为什么先禁用

按钮3和按钮4与当前保留链路存在功能重叠：

- 按钮7 `MayIP信息` 已经能获取 `country / region_name / city`。
- 按钮4生成地址依赖按钮3或按钮7保存的定位信息。
- 如果后续不再需要自动生成地址、姓名和测试卡，可以继续保留按钮7作为轻量 IP 信息入口，逐步移除按钮4相关链路。

## 影响范围

已禁用：

- 用户无法从 popup 直接点击按钮3。
- 用户无法从 popup 直接点击按钮4。

未禁用：

- 按钮7 `MayIP信息` 仍可点击。
- 按钮2 `提取页面` 仍可点击。
- 相关后端接口和日志解析逻辑仍保留。
- `popup.js` 中原按钮3/4代码仍可用于回滚或参考。

## 恢复方式

如果需要恢复按钮3和按钮4，移除 `chrome-extension/popup.html` 中两个按钮上的 `disabled` 属性即可：

```html
<button class="feature-button" data-feature="3" type="button">抓取IP信息</button>
<button class="feature-button" data-feature="4" type="button">提取地址</button>
```

不需要恢复 JavaScript 逻辑，因为本次没有删除。
