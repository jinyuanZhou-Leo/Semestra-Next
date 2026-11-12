import json, os, re


def courses():
    """The seeded course ids, read on each request: a re-seed changes them while the server runs."""
    return json.load(open(os.path.join(os.path.dirname(__file__), '.out', 'ids.json')))['courses']

TEXT_ZH = ('ECE216 期中在 **10 月 27 日（周二）18:00**，在那之前你还有三件事要交：\n\n'
                '- **ECE297 Milestone 2 slides**：明天中午 12:00\n'
                '- **MAT290 Problem Set 3**：周五 17:00\n'
                '- **ECE244 Lab 5**：周六 23:59\n\n'
                '周四下午和周日都没课，我按截止时间把复习插进空档，周日做真题、周一整理公式表，这两项已经加进待办。')
TEXT_EN = ('Your ECE216 midterm is **Tue, Oct 27 at 6:00 PM**. Before then you also have:\n\n'
                '- **ECE297 Milestone 2 slides**: tomorrow, 12:00 PM\n'
                '- **MAT290 Problem Set 3**: Fri, 5:00 PM\n'
                '- **ECE244 Lab 5**: Sat, 11:59 PM\n\n'
                'Thursday afternoon and Sunday are free, so I fit the review into those gaps. '
                'I added two tasks: the 2025 midterm on Sunday and your formula sheet on Monday.')

def respond(req):
    msgs = req['messages']
    first = json.dumps(msgs[-1].get('content'), ensure_ascii=False)
    users = [m for m in msgs if m['role'] == 'user']
    text_all = json.dumps(users, ensure_ascii=False)
    zh = bool(re.search(r'[一-鿿]', text_all.split('Sent')[-1] if 'Sent' in text_all else text_all))
    if msgs[0]['role'] == 'system' and str(msgs[0].get('content', '')).startswith('Write a title'):
        return ('ECE216 期中复习安排' if zh else 'ECE216 midterm prep'), []
    tools = sum(1 for m in msgs if m['role'] == 'tool')
    # Tools outside the core set have to be found first, as a real model would.
    if tools == 0:
        return '', [('search_tools', {'queries': ['calendar occurrences']}),
                    ('search_tools', {'queries': ['create task']})]
    if tools == 2:
        return '', [('calendar__occurrence__list', {'start': '2026-10-22', 'end': '2026-10-28'})]
    if tools >= 5:
        return TEXT_ZH if zh else TEXT_EN, []
    if zh:
        text = ('ECE216 期中在 **10 月 27 日（周二）18:00**，在那之前你还有三件事要交：\n\n'
                '- **ECE297 Milestone 2 slides**：明天中午 12:00\n'
                '- **MAT290 Problem Set 3**：周五 17:00\n'
                '- **ECE244 Lab 5**：周六 23:59\n\n'
                '周四下午和周日都没课，我按截止时间把复习插进空档，已经在周日加了一个做真题的待办，期中前一天留给整理公式表。')
        titles = ['复习 Laplace 变换与传递函数', '做 2025 年期中真题', '整理公式表并对答案']
    else:
        text = ('Your ECE216 midterm is **Tue, Oct 27 at 6:00 PM**. Before then you also have:\n\n'
                '- **ECE297 Milestone 2 slides**: tomorrow, 12:00 PM\n'
                '- **MAT290 Problem Set 3**: Fri, 5:00 PM\n'
                '- **ECE244 Lab 5**: Sat, 11:59 PM\n\n'
                'Thursday afternoon and Sunday are free, so I fit the review into those gaps. '
                'I added a task for Sunday to do the 2025 midterm, and left Monday for your formula sheet.')
        titles = ['Review Laplace transforms & transfer functions', 'Do the 2025 midterm', 'Make a formula sheet and check answers']
    # Two changes, each approved on its own card.
    calls = [('tasks__item__create', {'title': t, 'course_id': courses()['ECE216H1'], 'due_date': d})
             for t, d in zip(titles[1:], ['2026-10-25', '2026-10-26'])]
    return '', calls
