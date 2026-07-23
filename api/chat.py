from flask import Flask, request, jsonify
from flask_cors import CORS
import requests
import os
import re

app = Flask(__name__)
CORS(app)

MODEL_API_KEY = "81fb7bcd51824f508d4b800754bc69f4.IjmcK2MuCE7DiD9A"
MODEL_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"

# 缓存知识库分段
_kb_sections = None

def load_knowledge_base_sections():
    """加载知识库并按章节分段"""
    global _kb_sections
    if _kb_sections is not None:
        return _kb_sections
    
    kb_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'knowledge_base.md')
    if not os.path.exists(kb_path):
        return []
    
    with open(kb_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # 按 ## 标题分段
    sections = []
    current_title = ""
    current_content = ""
    
    for line in content.split('\n'):
        if line.startswith('## '):
            if current_title:
                sections.append({
                    'title': current_title,
                    'content': current_content.strip()
                })
            current_title = line.strip()
            current_content = ""
        else:
            current_content += line + '\n'
    
    if current_title:
        sections.append({
            'title': current_title,
            'content': current_content.strip()
        })
    
    _kb_sections = sections
    return sections

def find_relevant_sections(user_message, sections, max_chars=8000):
    """根据用户问题关键词匹配相关章节"""
    # 基础信息始终包含
    essential_titles = ['基本信息', '技能清单', '核心竞争力', '常见问答']
    
    relevant = []
    total_chars = 0
    
    # 先添加基础信息
    for sec in sections:
        for ess in essential_titles:
            if ess in sec['title']:
                if total_chars + len(sec['content']) < max_chars:
                    relevant.append(sec)
                    total_chars += len(sec['content'])
                break
    
    # 关键词匹配
    keywords = {
        '教育': ['学校', '专业', '大学', '教育', '课程', '学历', '绩点', 'GPA', '毕业'],
        '工作': ['工作', '银行', '经历', '信贷', '金融', '广发', '离职', '职业'],
        '项目': ['项目', '吃什么', '小程序', '水土保持', '博客', '被窝', '过虑', '蒸汽', '展馆', '游戏', '抗疫', '山麓'],
        '技能': ['技能', '技术', '工具', '语言', '框架', 'Vue', 'Unity', 'AI', 'Coze', '前端', '后端', '设计'],
        '求职': ['求职', '薪资', '期望', '规划', '转型', '转行', '优势'],
        '联系方式': ['联系', '邮箱', '电话', '微信'],
    }
    
    matched_categories = set()
    for category, words in keywords.items():
        for word in words:
            if word in user_message:
                matched_categories.add(category)
                break
    
    # 添加匹配到的章节
    for sec in sections:
        if sec in relevant:
            continue
        
        for cat in matched_categories:
            if cat in sec['title'] or cat in sec['content'][:100]:
                if total_chars + len(sec['content']) < max_chars:
                    relevant.append(sec)
                    total_chars += len(sec['content'])
                break
    
    # 如果匹配内容太少，添加项目经历摘要
    if total_chars < 2000:
        for sec in sections:
            if sec in relevant:
                continue
            if '项目' in sec['title']:
                # 只取前2000字符
                truncated = sec['content'][:2000]
                if total_chars + len(truncated) < max_chars:
                    relevant.append({
                        'title': sec['title'] + '（摘要）',
                        'content': truncated
                    })
                    total_chars += len(truncated)
                break
    
    return relevant

def build_prompt(user_message, sections):
    """构建系统提示词"""
    kb_text = "\n\n".join([f"{s['title']}\n{s['content']}" for s in sections])
    
    system_prompt = f"""你是许晓丹的AI助手，负责回答访客关于许晓丹的问题。

以下是许晓丹的相关信息：

{kb_text}

回答规则：
1. 必须基于上述信息回答，不要编造
2. 如果信息不足以回答，礼貌说明"这个问题我暂时无法回答，您可以直接联系许晓丹本人"
3. 回答简洁友好，语气自然，使用中文
4. 以许晓丹朋友的身份回答，不要暴露你是AI

访客问题："""
    
    return system_prompt

@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.json
        user_message = data.get('message', '')
        
        if not user_message.strip():
            return jsonify({'error': '请输入问题'}), 400
        
        if not MODEL_API_KEY:
            return jsonify({'error': 'API密钥未配置'}), 500
        
        sections = load_knowledge_base_sections()
        relevant = find_relevant_sections(user_message, sections)
        system_prompt = build_prompt(user_message, relevant)
        
        payload = {
            "model": "glm-4-flash",
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message}
            ],
            "temperature": 0.7
        }
        
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {MODEL_API_KEY}"
        }
        
        response = requests.post(MODEL_URL, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        
        result = response.json()
        answer = result['choices'][0]['message']['content']
        
        return jsonify({'answer': answer})
    
    except requests.exceptions.Timeout:
        return jsonify({'error': 'AI思考超时，请稍后重试'}), 504
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/health', methods=['GET'])
def health():
    sections = load_knowledge_base_sections()
    return jsonify({
        'status': 'ok',
        'sections': len(sections),
        'total_chars': sum(len(s['content']) for s in sections)
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)
