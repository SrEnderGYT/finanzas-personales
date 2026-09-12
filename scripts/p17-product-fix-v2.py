from pathlib import Path

source = Path('scripts/p17-product-fix.py').read_text()
old = '''replace(
    'backend/api/src/gmail-service.ts',
    "    const candidate = parseFinancialMail(input);\\n    if (!candidate) return;",
    "    const candidate = parseFinancialMail(input);\\n    if (!candidate) {\\n      await this.pool.query(\\n        `DELETE FROM app.gmail_financial_candidates\\n         WHERE user_id=$1 AND source_message_id=$2 AND status='pending'`,\\n        [userId, input.messageId],\\n      );\\n      return;\\n    }",
)'''
new = '''replace(
    'backend/api/src/gmail-service.ts',
    "    const candidate = parseFinancialMail({\\n      messageId,\\n      sender,\\n      subject,\\n      snippet,\\n      receivedAt: receivedAt.toISOString(),\\n    });\\n    if (!candidate) return;",
    "    const candidate = parseFinancialMail({\\n      messageId,\\n      sender,\\n      subject,\\n      snippet,\\n      receivedAt: receivedAt.toISOString(),\\n    });\\n    if (!candidate) {\\n      await this.pool.query(\\n        `DELETE FROM app.gmail_financial_candidates\\n         WHERE user_id=$1 AND source_message_id=$2 AND status='pending'`,\\n        [id, messageId],\\n      );\\n      return;\\n    }",
)'''
if old not in source:
    raise SystemExit('gmail-service patch definition not found in original repair script')
patched = source.replace(old, new, 1)
exec(compile(patched, 'p17-product-fix-v2', 'exec'))
