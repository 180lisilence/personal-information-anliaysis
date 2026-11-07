## 项目概述

OSINTool 是一个自动化爬虫客户端，包含一个Flask后端和一个Electron客户端，用于执行和管理爬虫任务。
> 网页端仓库：[osintool-web](https://gitee.com/djchanahcjd/osintool-web)


## 快速开始

### 安装依赖

在`frontend`目录下运行以下命令安装**前端依赖**：

```bash
npm install
```

在项目根目录下运行以下命令安装**后端依赖**：

```bash
pip install flask flask-cors flask[async] tinydb shortuuid requests lxml pandas aiofiles aiohttp apscheduler playwright
playwright install
```

### 启动前后端

在`根目录`启动**Flask后端**：

```bash
python app.py
```

在`frontend`目录启动**Electron客户端**：


```bash
npm start
```

> 请确保已经安装了 Playwright 所需的浏览器和驱动，可通过 `playwright install` 命令进行安装。



## 技术栈

基于**前后端分离**，构建 **Electron** **本地客户端**

### 前端

- 页面构建：HTML/CSS/JS
- 客户端开发：Electron
- 组件库：ElementUI

### 后端

- 本地服务器：Flask
- 数据爬取：Playwirght, Requests
- 定时任务：APSchedule
- 数据库：TinyDB



## 项目结构

```
├── frontend
│   ├── edit.html 	 		# 编辑页
│   ├── index.html  			# 列表页
│   ├── main.js 			# Electron主进程
│   ├── package.json
│   ├── preload.js  			# 预加载脚本（含API）
├── utils
│   ├── parsers  			# 解析器
│   │   ├── base.py
│   │   ├── csv_parser.py
│   │   ├── html_parser.py
│   │   └── txt_parser.py
│   ├── common.py  			# 通用函数
│   ├── logger.py  			# 日志模块
│   ├── parser_factory.py  	        # 解析器工厂
├── app.py  				# Flask后端（含API）
├── db.json  				# TinyDB数据库
```



## 解析器流程图

### TXTParser

![image-20250303203737825](https://djchan-xyz.pages.dev/file/AgACAgUAAyEGAASJIjr1AAICiGfFoxi3bIdwvIiU94eog5ZbiCJeAAL1wzEb3fAwVtcmLMAcq5nmAQADAgADeQADNgQ.png)

### CSVParser

![image-20250303203803022](https://djchan-xyz.pages.dev/file/AgACAgUAAyEGAASJIjr1AAICiWfFoxqbPOEoQK6CWQAB1IGh73xkhAAC9sMxG93wMFaYhIPtx2weqQEAAwIAA3kAAzYE.png)

### HTMLParser

![image-20250303203818303](https://djchan-xyz.pages.dev/file/AgACAgUAAyEGAASJIjr1AAICimfFoxzLLYq7shI0c8LBIn8n1p5WAAL3wzEb3fAwVmpaMTByYxv2AQADAgADeQADNgQ.png)

## 预览图

### 任务列表页（index.html）

![image-20250301183926480](https://djchan-xyz.pages.dev/file/AgACAgUAAyEGAASJIjr1AAICh2fC4-HOyqgoF9BA7GQzpsEpu2L0AAI3wTEb6_wYVsDmm7bD_FC7AQADAgADdwADNgQ.png)

### 任务编辑页（edit.html）

![image-20250301183707849](https://djchan-xyz.pages.dev/file/AgACAgUAAyEGAASJIjr1AAIChmfC41tJdUTdt5uvGi1PxAxR2Ce1AAI1wTEb6_wYVtBNUuqQoP4PAQADAgADdwADNgQ.png)



## Todo

- 支持CSV输出
- 处理OCR/滑动验证码等人机验证
- CI/CD
- 支持网页端部署



## SWOT分析

- **Strengths（优势）**：支持多类型数据解析，自定义程度高 （登录、翻页等），任务调度灵活。
- **Weaknesses（劣势）**：学习成本高，需网页分析与正则基础；可视化差，没有直观界面；暂时无法应对人机验证等反爬技术。
- **Opportunities（机会）**：未来可融合AI实现智能爬取，集成如Excel等工具方便数据分析。
- **Threats（威胁）**：市场已有八爪鱼、EasySpider 等成熟可视化爬取工具；网页反爬技术迭代快 ，需持续更新爬取技术。



## 参考项目

- [八爪鱼采集器](https://www.bazhuayu.com/)
- [EasySpider](https://www.easyspider.net/)