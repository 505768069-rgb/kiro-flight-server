# Kiro Flight Mode Server

Kiro 飞行模式后端服务器 - 用于管理用户、激活码和账号切换

## 🚀 快速部署到 Render

### 第一步：推送到 GitHub

```bash
cd kiro-flight-server
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/kiro-flight-server.git
git push -u origin main
```

### 第二步：在 Render 创建 Web Service

1. 访问 https://render.com
2. 用 GitHub 账号登录
3. 点击 "New +" → "Web Service"
4. 连接你的 GitHub 仓库 `kiro-flight-server`
5. 配置：
   - **Name**: `kiro-flight-server`（或你喜欢的名字）
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

6. 添加环境变量：
   - `NODE_ENV` = `production`
   - `ADMIN_TOKEN` = `your-secret-token-change-this`（改成你自己的密钥）

7. 点击 "Create Web Service"

### 第三步：添加 PostgreSQL 数据库

1. 在 Render Dashboard，点击 "New +" → "PostgreSQL"
2. 配置：
   - **Name**: `kiro-flight-db`
   - **Plan**: `Free`
3. 点击 "Create Database"
4. 等待数据库创建完成
5. 回到你的 Web Service
6. 在 "Environment" 标签页，点击 "Add Environment Variable"
7. Render 会自动提供 `DATABASE_URL`，选择你刚创建的数据库

### 第四步：等待部署完成

部署需要 3-5 分钟，完成后你会得到一个地址：

```
https://kiro-flight-server-xxxx.onrender.com
```

## 📝 创建激活码

部署成功后，使用以下命令创建激活码：

```bash
curl -X POST https://your-app.onrender.com/admin/create-code \
  -H "Content-Type: application/json" \
  -d '{
    "code": "KIRO-2024-TEST-0001",
    "points": 1000,
    "expire_days": 30,
    "admin_token": "your-secret-token-change-this"
  }'
```

## 🧪 测试 API

### 1. 健康检查

```bash
curl https://your-app.onrender.com/health
```

### 2. 用户登录

```bash
curl -X POST https://your-app.onrender.com/api/user/login \
  -H "Content-Type: application/json" \
  -d '{"device_id":"test-device-123"}'
```

### 3. 激活激活码

```bash
curl -X POST https://your-app.onrender.com/api/activate \
  -H "Content-Type: application/json" \
  -d '{
    "device_id":"test-device-123",
    "code":"KIRO-2024-TEST-0001"
  }'
```

### 4. 查看统计

```bash
curl "https://your-app.onrender.com/admin/stats?admin_token=your-secret-token-change-this"
```

## 📊 API 文档

### 用户接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/user/login` | POST | 用户登录/注册 |
| `/api/user/logout` | POST | 退出激活码 |
| `/api/activate` | POST | 激活激活码 |
| `/api/google/exchange` | POST | 提取账号（消耗100积分） |
| `/api/google/token` | POST | 获取账号Token |
| `/api/account/hide` | POST | 删除账号 |
| `/api/announcement` | GET | 获取公告 |

### 管理接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/admin/create-code` | POST | 创建激活码（需要admin_token） |
| `/admin/stats` | GET | 查看统计信息（需要admin_token） |

## 🔧 本地开发

```bash
# 安装依赖
npm install

# 复制环境变量
cp .env.example .env

# 编辑 .env 文件，填入数据库配置

# 开发模式运行
npm run dev

# 构建
npm run build

# 生产模式运行
npm start
```

## 📦 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `PORT` | 服务器端口 | `3000` |
| `NODE_ENV` | 运行环境 | `production` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | `postgresql://...` |
| `ADMIN_TOKEN` | 管理员令牌 | `your-secret-token` |

## 🛡️ 安全建议

1. ✅ 修改 `ADMIN_TOKEN` 为强密码
2. ✅ 不要将 `.env` 文件提交到 Git
3. ✅ 定期备份数据库
4. ✅ 监控服务器日志

## 📈 性能优化

### 防止 Render 休眠

Render 免费方案会在 15 分钟无请求后休眠。解决方案：

1. 使用 UptimeRobot (https://uptimerobot.com) 每 5 分钟 ping 一次
2. 或升级到 Render 付费方案（$7/月）

### 数据库优化

- 定期清理已删除的账号
- 添加数据库索引（已自动创建）
- 监控数据库大小（免费 1GB）

## 🐛 故障排除

### 数据库连接失败

检查 `DATABASE_URL` 环境变量是否正确设置

### 激活码创建失败

确保 `ADMIN_TOKEN` 正确，且激活码格式唯一

### 服务器无响应

检查 Render 日志，可能是数据库连接问题

## 📞 支持

如有问题，请查看：
- Render 文档: https://render.com/docs
- PostgreSQL 文档: https://www.postgresql.org/docs/

## 📄 许可证

MIT License
