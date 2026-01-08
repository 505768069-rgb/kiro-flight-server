import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(bodyParser.json());

// 数据库连接池
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 初始化数据库表
async function initDatabase() {
    try {
        console.log('🔄 初始化数据库...');

        // 用户表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                device_id VARCHAR(32) UNIQUE NOT NULL,
                points INTEGER DEFAULT 0,
                activated_code VARCHAR(50),
                expire_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 账号表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS accounts (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                email VARCHAR(255),
                password VARCHAR(255),
                source VARCHAR(20) DEFAULT 'google',
                refresh_token TEXT NOT NULL,
                access_token TEXT,
                client_id VARCHAR(255),
                client_secret TEXT,
                is_hidden BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 激活码表
        await pool.query(`
            CREATE TABLE IF NOT EXISTS activation_codes (
                id SERIAL PRIMARY KEY,
                code VARCHAR(50) UNIQUE NOT NULL,
                points INTEGER NOT NULL,
                expire_at TIMESTAMP NOT NULL,
                is_used BOOLEAN DEFAULT FALSE,
                used_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 创建索引
        await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_users_device_id ON users(device_id);
            CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
            CREATE INDEX IF NOT EXISTS idx_activation_codes_code ON activation_codes(code);
        `);

        console.log('✅ 数据库表初始化成功');
    } catch (error) {
        console.error('❌ 数据库初始化失败:', error);
        throw error;
    }
}

// 测试数据库连接
pool.connect()
    .then(client => {
        console.log('✅ 数据库连接成功');
        client.release();
        return initDatabase();
    })
    .catch(err => {
        console.error('❌ 数据库连接失败:', err);
        process.exit(1);
    });

// ==================== API 路由 ====================

// 健康检查
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Kiro Flight Mode Server',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 1. 用户登录/注册
app.post('/api/user/login', async (req, res) => {
    try {
        const { device_id } = req.body;

        if (!device_id) {
            return res.json({ code: 1, message: '缺少 device_id' });
        }

        // 查找用户
        const userResult = await pool.query('SELECT * FROM users WHERE device_id = $1', [device_id]);
        
        if (userResult.rows.length === 0) {
            // 创建新用户
            await pool.query('INSERT INTO users (device_id, points) VALUES ($1, $2)', [device_id, 0]);
            console.log(`📝 新用户注册: ${device_id}`);
            return res.json({
                code: 0,
                data: {
                    points: 0,
                    is_activated: false,
                    accounts: [],
                    activated_code: null
                }
            });
        }

        const user = userResult.rows[0];
        
        // 获取账号列表
        const accountsResult = await pool.query(
            'SELECT * FROM accounts WHERE user_id = $1 AND is_hidden = FALSE',
            [user.id]
        );

        const activatedCode = user.activated_code ? {
            code: user.activated_code,
            expire_at: user.expire_at
        } : null;

        console.log(`👤 用户登录: ${device_id}, 积分: ${user.points}, 账号数: ${accountsResult.rows.length}`);

        res.json({
            code: 0,
            data: {
                points: user.points,
                is_activated: user.points > 0 || !!user.activated_code,
                accounts: accountsResult.rows,
                activated_code: activatedCode
            }
        });
    } catch (error) {
        console.error('❌ 登录错误:', error);
        res.json({ code: 1, message: '服务器错误' });
    }
});

// 2. 退出激活码
app.post('/api/user/logout', async (req, res) => {
    try {
        const { device_id } = req.body;
        await pool.query(
            'UPDATE users SET activated_code = NULL, expire_at = NULL WHERE device_id = $1',
            [device_id]
        );
        console.log(`🚪 用户退出: ${device_id}`);
        res.json({ code: 0, message: '退出成功' });
    } catch (error) {
        console.error('❌ 退出错误:', error);
        res.json({ code: 1, message: '退出失败' });
    }
});

// 3. 激活激活码
app.post('/api/activate', async (req, res) => {
    try {
        const { device_id, code } = req.body;

        if (!device_id || !code) {
            return res.json({ code: 1, message: '参数错误' });
        }

        // 查找激活码
        const codeResult = await pool.query(
            'SELECT * FROM activation_codes WHERE code = $1 AND is_used = FALSE',
            [code]
        );

        if (codeResult.rows.length === 0) {
            console.log(`⚠️ 激活失败: 激活码无效或已使用 - ${code}`);
            return res.json({ code: 1, message: '激活码无效或已使用' });
        }

        const activationCode = codeResult.rows[0];

        // 检查是否过期
        if (new Date(activationCode.expire_at) < new Date()) {
            console.log(`⚠️ 激活失败: 激活码已过期 - ${code}`);
            return res.json({ code: 1, message: '激活码已过期' });
        }

        // 查找用户
        const userResult = await pool.query('SELECT * FROM users WHERE device_id = $1', [device_id]);
        
        if (userResult.rows.length === 0) {
            return res.json({ code: 1, message: '用户不存在' });
        }

        const user = userResult.rows[0];
        const newPoints = user.points + activationCode.points;

        // 更新用户
        await pool.query(
            'UPDATE users SET points = $1, activated_code = $2, expire_at = $3 WHERE id = $4',
            [newPoints, code, activationCode.expire_at, user.id]
        );

        // 标记激活码已使用
        await pool.query(
            'UPDATE activation_codes SET is_used = TRUE, used_by = $1 WHERE id = $2',
            [user.id, activationCode.id]
        );

        // 获取账号列表
        const accountsResult = await pool.query(
            'SELECT * FROM accounts WHERE user_id = $1 AND is_hidden = FALSE',
            [user.id]
        );

        console.log(`✅ 激活成功: ${device_id}, 激活码: ${code}, 新积分: ${newPoints}`);

        res.json({
            code: 0,
            data: {
                current_points: newPoints,
                expire_at: activationCode.expire_at,
                accounts: accountsResult.rows
            }
        });
    } catch (error) {
        console.error('❌ 激活错误:', error);
        res.json({ code: 1, message: '激活失败' });
    }
});

// 4. 提取账号
app.post('/api/google/exchange', async (req, res) => {
    try {
        const { device_id } = req.body;

        const userResult = await pool.query('SELECT * FROM users WHERE device_id = $1', [device_id]);
        
        if (userResult.rows.length === 0) {
            return res.json({ code: 1, message: '用户不存在' });
        }

        const user = userResult.rows[0];

        if (user.points < 100) {
            console.log(`⚠️ 提取失败: 积分不足 - ${device_id}, 当前积分: ${user.points}`);
            return res.json({ code: 1, message: '积分不足，需要100积分' });
        }

        // 创建测试账号（实际使用时需要从账号池获取）
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 10);
        const newAccount = {
            email: `kiro${timestamp}@example.com`,
            refresh_token: `aor_${randomStr}${timestamp}`,
            client_id: `client_${randomStr}`,
            client_secret: `secret_${randomStr}${timestamp}`,
            source: 'google'
        };

        const accountResult = await pool.query(
            'INSERT INTO accounts (user_id, email, refresh_token, client_id, client_secret, source) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
            [user.id, newAccount.email, newAccount.refresh_token, newAccount.client_id, newAccount.client_secret, newAccount.source]
        );

        const accountId = accountResult.rows[0].id;
        const remainingPoints = user.points - 100;

        // 扣除积分
        await pool.query('UPDATE users SET points = $1 WHERE id = $2', [remainingPoints, user.id]);

        console.log(`💰 提取账号: ${device_id}, 账号ID: ${accountId}, 剩余积分: ${remainingPoints}`);

        res.json({
            code: 0,
            data: {
                account_id: accountId,
                email: newAccount.email,
                refresh_token: newAccount.refresh_token,
                client_id: newAccount.client_id,
                client_secret: newAccount.client_secret,
                remaining_points: remainingPoints
            }
        });
    } catch (error) {
        console.error('❌ 提取账号错误:', error);
        res.json({ code: 1, message: '提取失败' });
    }
});

// 5. 获取账号 Token
app.post('/api/google/token', async (req, res) => {
    try {
        const { device_id, account_id } = req.body;

        const userResult = await pool.query('SELECT * FROM users WHERE device_id = $1', [device_id]);
        
        if (userResult.rows.length === 0) {
            return res.json({ code: 1, message: '用户不存在' });
        }

        const user = userResult.rows[0];

        const accountResult = await pool.query(
            'SELECT * FROM accounts WHERE id = $1 AND user_id = $2',
            [account_id, user.id]
        );

        if (accountResult.rows.length === 0) {
            return res.json({ code: 1, message: '账号不存在' });
        }

        const account = accountResult.rows[0];

        console.log(`🔑 获取Token: ${device_id}, 账号: ${account.email}`);

        res.json({
            code: 0,
            data: {
                email: account.email,
                refresh_token: account.refresh_token,
                access_token: account.access_token,
                client_id: account.client_id,
                client_secret: account.client_secret
            }
        });
    } catch (error) {
        console.error('❌ 获取Token错误:', error);
        res.json({ code: 1, message: '获取失败' });
    }
});

// 6. 删除账号
app.post('/api/account/hide', async (req, res) => {
    try {
        const { device_id, account_id } = req.body;

        const userResult = await pool.query('SELECT * FROM users WHERE device_id = $1', [device_id]);
        
        if (userResult.rows.length === 0) {
            return res.json({ code: 1, message: '用户不存在' });
        }

        const user = userResult.rows[0];

        await pool.query(
            'UPDATE accounts SET is_hidden = TRUE WHERE id = $1 AND user_id = $2',
            [account_id, user.id]
        );

        console.log(`🗑️ 删除账号: ${device_id}, 账号ID: ${account_id}`);

        res.json({ code: 0, message: '删除成功' });
    } catch (error) {
        console.error('❌ 删除账号错误:', error);
        res.json({ code: 1, message: '删除失败' });
    }
});

// 7. 获取公告
app.get('/api/announcement', (req, res) => {
    res.json({
        code: 0,
        data: {
            announcement: '🎉 欢迎使用 Kiro 飞行模式！<br>💰 100积分 = 1个账号<br>📧 联系管理员获取激活码'
        }
    });
});

// ==================== 管理接口 ====================

// 创建激活码（需要管理员令牌）
app.post('/admin/create-code', async (req, res) => {
    const { code, points, expire_days, admin_token } = req.body;

    // 验证管理员令牌
    if (admin_token !== process.env.ADMIN_TOKEN) {
        console.log(`⚠️ 未授权的创建激活码请求`);
        return res.json({ code: 1, message: '无权限' });
    }

    if (!code || !points || !expire_days) {
        return res.json({ code: 1, message: '参数错误' });
    }

    try {
        const expireAt = new Date();
        expireAt.setDate(expireAt.getDate() + expire_days);

        await pool.query(
            'INSERT INTO activation_codes (code, points, expire_at) VALUES ($1, $2, $3)',
            [code, points, expireAt]
        );

        console.log(`✅ 创建激活码: ${code}, 积分: ${points}, 有效期: ${expire_days}天`);

        res.json({
            code: 0,
            message: '激活码创建成功',
            data: { code, points, expire_at: expireAt }
        });
    } catch (error) {
        console.error('❌ 创建激活码错误:', error);
        res.json({ code: 1, message: '创建失败，激活码可能已存在' });
    }
});

// 查看统计信息（需要管理员令牌）
app.get('/admin/stats', async (req, res) => {
    const { admin_token } = req.query;

    if (admin_token !== process.env.ADMIN_TOKEN) {
        return res.json({ code: 1, message: '无权限' });
    }

    try {
        const usersResult = await pool.query('SELECT COUNT(*) as count FROM users');
        const accountsResult = await pool.query('SELECT COUNT(*) as count FROM accounts WHERE is_hidden = FALSE');
        const codesResult = await pool.query('SELECT COUNT(*) as count FROM activation_codes WHERE is_used = FALSE');

        res.json({
            code: 0,
            data: {
                total_users: parseInt(usersResult.rows[0].count),
                total_accounts: parseInt(accountsResult.rows[0].count),
                unused_codes: parseInt(codesResult.rows[0].count)
            }
        });
    } catch (error) {
        res.json({ code: 1, message: '获取统计失败' });
    }
});

// 404 处理
app.use((req, res) => {
    res.status(404).json({ code: 404, message: 'API 不存在' });
});

// 错误处理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('服务器错误:', err);
    res.status(500).json({ code: 500, message: '服务器内部错误' });
});

// 启动服务器
app.listen(PORT, () => {
    console.log('');
    console.log('🚀 ================================');
    console.log('🚀 Kiro Flight Mode Server');
    console.log('🚀 ================================');
    console.log(`📡 服务器运行在端口: ${PORT}`);
    console.log(`🌍 环境: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 访问: http://localhost:${PORT}`);
    console.log('🚀 ================================');
    console.log('');
});

// 优雅关闭
process.on('SIGTERM', () => {
    console.log('收到 SIGTERM 信号，正在关闭服务器...');
    pool.end(() => {
        console.log('数据库连接已关闭');
        process.exit(0);
    });
});
