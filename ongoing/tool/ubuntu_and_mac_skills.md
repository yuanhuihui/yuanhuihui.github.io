## Ubuntu

1. 如何设置环境变量
gedit ~/.bashrc

编译内容设置为:export PATH=~/gityuan/tool:$PATH

source ~/.bashrc


2. 自动弹出设备

打开终端
禁止自动挂载：
$ gsettings set org.gnome.desktop.media-handling automount false
禁止自动挂载并打开
$ gsettings set org.gnome.desktop.media-handling automount-open false
允许自动挂载
$ gsettings set org.gnome.desktop.media-handlingautomount true
允许自动挂载并打开
$ gsettings set org.gnome.desktop.media-handling automount-open true

## Mac

ctrl + cmd + h: 级联
ctrl + cmd + j： 调用

