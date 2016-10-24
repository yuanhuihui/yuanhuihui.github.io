
### 1. LIST_HEAD_INIT
 
	#define LIST_HEAD_INIT(name) { &(name), &(name) }
	#define LIST_HEAD(name) /
	    struct list_head name = LIST_HEAD_INIT(name)

等价于：

	#define LIST_HEAD(name)/
	struct list_head name = {&(name),&(name)}

最后等价于

	struct list_head head;
	head.prev=&head;
	head.next=&prev;

## 红黑树

### rb_insert_color
node是新插入的结点，有着默认的红色，本函数检查是否有违背红黑树性质的地方，并进行调整。

	void rb_insert_color(rb_node *node, rb_root *root)

### rb_link_node


把parent设为node的父结点，并且让rb_link指向node。

	static inline void rb_link_node(struct rb_node * node, struct rb_node * parent, struct rb_node ** rb_link);

## 其他

	struct rb_root 
	struct rb_node

	struct hlist_node
	struct hlist_head
	struct list_head 


1 struct hlist_head定义： 

	struct hlist_head {
	   struct hlist_node *first;
	};
	struct hlist_node {
	   struct hlist_node *next, **pprev;
	};

2 struct list_head定义：

	struct list_head {
	 struct list_node *next，*prev;
	};


## binder static

static HLIST_HEAD(binder_deferred_list);
static HLIST_HEAD(binder_dead_nodes);


static struct workqueue_struct *binder_deferred_workqueue;