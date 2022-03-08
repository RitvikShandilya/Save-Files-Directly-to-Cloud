
var io =  io.connect(window.location.href);
Vue.config.debug = true;
Vue.config.silent = false;

io.on('takeYourToken',function(data){
    if(typeof data === 'object' && data.hasOwnProperty('token')){
            document.cookie = "id=" + data.token;
    }
});

io.on('userMessage',function(data){
    new Toastify({
        text: data.message,
        duration: 4000,
        close: true,
        gravity: "top", // `top` or `bottom`
        positionLeft: false, // `true` or `false`
        backgroundColor: "linear-gradient(to right, #00b09b, #96c93d)"
    }).showToast();
});

var fileList = new Vue({
    el: "#files",
    data: {
        test: 'ritvik',
        files: [],
        file_url: undefined,
        message: '',
        loading: true,
        fileDetails: [],
        email :undefined,
        enabled: false,
        gradient: 'to top, #5cbbf6, #1867c0',
        gradient2: 'to top, #1867c0, #5cbbf6',
        isEmail: false,
        loader: null,
        loading4: false,
        emailRules: [
            v => {
              return !!v || 'E-mail is required'
            },
            v => /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/.test(v) || 'E-mail must be valid'
          ]
    },
    methods: {
        submitUrlForUpload(){
            if(this.loading) {
                return;
            }
            this.loading =true;
            if (this.file_url.trim().length < 3) return;

            var url = '/api/upload?url=' + encodeURIComponent(this.file_url);
            if(this.isEmail && this.email && this.email.trim().length > 3){
               url = url +"&email="+this.email;
            }

            this.$http.get(url)
                .then(function(response){
                    if (response.data.success) {
                        response.data.data.url =  this.file_url;
                        response.data.data.type = response.data.data['content-type'];
                        var data = response.data.data;
                        data.progress = {
                            at : 0,
                            uploaded :0,
                            remains :0,
                            eta :0,
                            speed:0,
                            arr: [0]
                        }
                        this.fileDetails.push(data);
                        this.message= '';
                        this.file_url='';
                    } else {
                        this.message=response.data.data;
                        new Toastify({
                            text: response.data.data,
                            duration: 4000,
                            close: true,
                            gravity: "bottom", // `top` or `bottom`
                            positionLeft: false, // `true` or `false`
                            backgroundColor: "linear-gradient(to right, #ff5f6d, #ffc371)"
                        }).showToast();
                    }
                    this.loading  = false;
                });
        },
        toggleView :function(index){
            $("#"+index).toggle(500);
        },
        removeView: function(index){
            if(!confirm("Are you sure you want to remove this? you will not see any progress")) return;
            this.fileDetails.splice(index,1);
        }
    },
    created(){
        this.$http.get('/api/lists',{})
            .then(function(response){
                this.loading=false;
                if(response.data.success){
                    this.files=response.data.data;
                }
                else{
                    if(typeof response.data != 'object'){
                        this.message=response.data;
                    }
                    else{
                        this.message=response.data.data;
                    }
                }
            });
    },
    computed: {
        reverseItems() {
            return this.fileDetails.slice().reverse();
        },
        headingClasses () {
            return {
              'mt-4': true,
              'mb-4': true,
              'display-2': this.$vuetify.breakpoint.xsOnly,
              'display-3': this.$vuetify.breakpoint.smAndUp
            }
        }
    },
    watch: {
        loader () {
          const l = this.loader
          this[l] = !this[l]

          setTimeout(() => (this[l] = false), 10000)

          this.loader = null
        }
      },
	mounted() {
	return (function(d, s, id) {
  var js, fjs = d.getElementsByTagName(s)[0];
  if (d.getElementById(id)) return;
  js = d.createElement(s); js.id = id;
  js.src = 'https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v2.12&autoLogAppEvents=1';
  fjs.parentNode.insertBefore(js, fjs);
}(document, 'script', 'facebook-jssdk'));
}
});

io.on('upload',function(data){
    var item = _.findWhere(fileList.fileDetails,{hash:data.fileId});
    if(!item)return;
    item.progress.at = data.progress.percentage;
    item.progress.uploaded = data.progress.transferred;
    item.progress.remains = data.progress.remaining;
    item.progress.eta = data.progress.eta || 'Completed';
    item.progress.speed = data.progress.speed;
    item.progress.arr.push(data.progress.graph);
if(item.progress.at >= 100){
        $("#"+data.fileId).removeClass("active");
    }
    // $("#"+data.fileId).css("width",data.progress.percentage+"%");
});

