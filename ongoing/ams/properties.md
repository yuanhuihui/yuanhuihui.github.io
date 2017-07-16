frameworks/base/core/jni/android_os_SystemProperties.cpp
    SystemProperties_set


/system/core/libcutils/properties.c
    property_set

/bionic/libc/bionic/system_properties.cpp
    __system_property_set
        send_prop_msg


更下面无关

system/core/init/property_service.cpp
     property_set
        property_set_impl

bionic/libc/bionic/system_properties.cpp
    __system_property_add
         prop_area::add()
            prop_area::find_property()
