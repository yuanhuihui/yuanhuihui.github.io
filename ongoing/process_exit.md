SIGHUP会在以下3种情况下被发送给相应的进程：
 1、终端关闭时，该信号被发送到session首进程以及作为job提交的进程（即用 & 符号提交的进程）
 2、session首进程退出时，该信号被发送到该session中的前台进程组中的每一个进程
 3、若父进程退出导致进程组成为孤儿进程组，且该进程组中有进程处于停止状态（收到SIGSTOP或SIGTSTP信号），该信号会被发送到该进程组中的每一个进程。

return task->group_leader->pids[PIDTYPE_SID].pid;
return task->group_leader->pids[PIDTYPE_PGID].pid;


taask的group_leader

测试kill -9 -123?
看看pgid情况

结论：
1. 由init创建的进程，其pgid都是自己。包括zygote和zygote64
2. 不管由zygote还是zygote64所创建的进程， 其pgid都是zygote64， 为何呢？ http://wiki.n.miui.com/pages/viewpage.action?pageId=18999890
3. 绝大部分的sid都是0, 但是init进程创建的子进程ppid和sid都是自己的pid,为何？

get_signal
    dequeue_signal
    do_group_exit
        zap_other_threads
            sigaddset(&t->pending.signal, SIGKILL)， for
    do_exit
        exit_xx, 释放内存，文件等资源
        exit_notify
            forget_original_parent
                reparent_leader
                    kill_orphaned_pgrp   ==》 (p, father);
            kill_orphaned_pgrp   ==》 (tsk->group_leader, NULL);
            do_notify_parent


http://www.gnu.org/software/libc/manual/html_node/Orphaned-Process-Groups.html


### 1 exit_notify

    static void exit_notify(struct task_struct *tsk, int group_dead)
    {
        bool autoreap;
        struct task_struct *p, *n;
        LIST_HEAD(dead);

        write_lock_irq(&tasklist_lock);
        forget_original_parent(tsk, &dead);

        if (group_dead)
            kill_orphaned_pgrp(tsk->group_leader, NULL);  //线程组的领头线程

        if (unlikely(tsk->ptrace)) {
            int sig = thread_group_leader(tsk) &&
                    thread_group_empty(tsk) &&
                    !ptrace_reparented(tsk) ?
                tsk->exit_signal : SIGCHLD;
            autoreap = do_notify_parent(tsk, sig);
        } else if (thread_group_leader(tsk)) {
            autoreap = thread_group_empty(tsk) &&
                do_notify_parent(tsk, tsk->exit_signal);
        } else {
            autoreap = true;
        }

        tsk->exit_state = autoreap ? EXIT_DEAD : EXIT_ZOMBIE;
        if (tsk->exit_state == EXIT_DEAD)
            list_add(&tsk->ptrace_entry, &dead);

        /* mt-exec, de_thread() is waiting for group leader */
        if (unlikely(tsk->signal->notify_count < 0))
            wake_up_process(tsk->signal->group_exit_task);
        write_unlock_irq(&tasklist_lock);

        list_for_each_entry_safe(p, n, &dead, ptrace_entry) {
            list_del_init(&p->ptrace_entry);
            release_task(p);
        }
    }

### 2 forget_original_parent
static void forget_original_parent(struct task_struct *father,
                    struct list_head *dead)
{
    struct task_struct *p, *t, *reaper;

    reaper = find_child_reaper(father);
    if (list_empty(&father->children))
        return;

    reaper = find_new_reaper(father, reaper);
    list_for_each_entry(p, &father->children, sibling) {
        for_each_thread(p, t) {
            t->real_parent = reaper;
            if (likely(!t->ptrace))
                t->parent = t->real_parent;
            if (t->pdeath_signal)
                group_send_sig_info(t->pdeath_signal,
                            SEND_SIG_NOINFO, t);
        }

        if (!same_thread_group(reaper, father))
            reparent_leader(father, p, dead); //此处
    }
    list_splice_tail_init(&father->children, &reaper->children);
}


static void reparent_leader(struct task_struct *father, struct task_struct *p,
                struct list_head *dead)
{
    if (unlikely(p->exit_state == EXIT_DEAD))
        return;

    p->exit_signal = SIGCHLD;

    if (!p->ptrace && p->exit_state == EXIT_ZOMBIE && thread_group_empty(p)) {
        if (do_notify_parent(p, p->exit_signal)) {
            p->exit_state = EXIT_DEAD;
            list_add(&p->ptrace_entry, dead);
        }
    }

    kill_orphaned_pgrp(p, father);
}


### kill_orphaned_pgrp
    static void kill_orphaned_pgrp(struct task_struct *tsk, struct task_struct *parent)
    {
        struct pid *pgrp = task_pgrp(tsk); //zygote64
        struct task_struct *ignored_task = tsk;

        if (!parent)
            parent = tsk->real_parent;
        else
            ignored_task = NULL;

        if (task_pgrp(parent) != pgrp &&  task_pgrp(p->real_parent) == pgrp
            task_session(parent) == task_session(tsk) &&
            will_become_orphaned_pgrp(pgrp, ignored_task) &&
            has_stopped_jobs(pgrp)) {
            __kill_pgrp_info(SIGHUP, SEND_SIG_PRIV, pgrp);
            __kill_pgrp_info(SIGCONT, SEND_SIG_PRIV, pgrp);
        }
    }

task_pgrp(parent) != pgrp ： task的领头进程跟parent不相等
task_session(parent) == task_session(tsk)： 相等

will_become_orphaned_pgrp(pgrp, ignored_task)： 孤儿进程组

has_stopped_jobs(pgrp)： 有进程处于SIGNAL_STOP_STOPPED状态

### will_become_orphaned_pgrp

static int will_become_orphaned_pgrp(struct pid *pgrp,
                    struct task_struct *ignored_task)
{
    struct task_struct *p;
    do_each_pid_task(pgrp, PIDTYPE_PGID, p) {
        if ((p == ignored_task) || //跟进程自己是同一个的， 则忽略
            (p->exit_state && thread_group_empty(p)) ||  //线程组要退出。
            is_global_init(p->real_parent))  //判定父进程是否为init进程
            continue;

        if (task_pgrp(p->real_parent) != pgrp &&  //tim不满足这个条件
            task_session(p->real_parent) == task_session(p))
            return 0;
    } while_each_pid_task(pgrp, PIDTYPE_PGID, p);
    return 1;   //同一个igid的，都是同一个组。 进程不等于task, 父进程并非init, 并且进程退出状态不等于null的情况，则认为是孤儿进程组。
}
