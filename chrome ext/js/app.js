let mainAPI = API();

$(function(){
    var translator = $('body').translate({lang: mainAPI.lang, t: dict});
    mainAPI.sendSettingRequest().then(movies => {
        $("#main-logo").attr('src',mainAPI._root+movies.logo_white);
    });
});

$.ajax({
    url: mainAPI.user(),
    dataType : "json",
    success: function (result, textStatus) {
        var data = result.data;
        if(result.isAuth){
            $(".show-auth-user").show();
            $(".user-info").text(data.email);
            $("#userBalance").text(data.balance);

            $("#userReferralBalance").text(data.referral_balance);
            $("#ref-percent").text(data.referral_percent);
            $('#referral-link').val(mainAPI.getReferralUrl(data.id));
            copyReferralLink();
            shareIcons(data.id);

            // update in 1.1.9
            CBSInstallControl.loadInstallCode().then((code) => {
                $("#userCode").text( code );
            });         

        }else{
            $(".show-auth-user").hide();
            $(".auth-block").show();
            $(".auth-block a").attr('href',mainAPI.getLoginUrl().replace(/javascript[:]/gi, ''));

            clearLocalStorage( [ "install_id" ] );
            $("#userCode").hide();
        }

        $('#all-shop-link').attr('href',mainAPI.getAllShopUrl().replace(/javascript[:]/gi, ''));
        $('#all-order-link').attr('href',mainAPI.getOrdersUrl().replace(/javascript[:]/gi, ''));
    },
    error: function () {
        $('.main-window').hide();
        $('.error-block').show();
    }
});

$.ajax({
    url: mainAPI.newShops(),
    dataType : "json",
    success: function (result, textStatus) {
        $.each( result.data, function( key, value ) {

            var iconFav = value.is_favorite ? 'favorite' : 'favorite_border';

            var item = '                 <a href="'+mainAPI.getGoUrl(value.id,value.go_link).replace(/javascript[:]/gi, '')+'" target="_blank" class="list-group-item list-group-item-action">' +
                '                            <div class="row">' +
                '                                <div class="col-4"><img src="'+mainAPI.getFullUrlImg(value.logo).replace(/javascript[:]/gi, '')+'" class="img-logo"></div>' +
                '                                <div class="col-5"><span>'+value.url+'</span></div>' +
                '                                <div class="col-3"><b>'+value.tariff_rate+'</b></div>' +
                '                            </div>' +
                '                        </a>';
            var cleanHTML = DOMPurify.sanitize(item, { USE_PROFILES: { html: true },ADD_ATTR: ['target']});


            $('.new-shops').append(cleanHTML);
        });
    },
    error: function () {
        $('.main-window').hide();
        $('.error-block').show();
    }
});

$.ajax({
    url: mainAPI.getAllOrders(),
    dataType : "json",
    success: function (result, textStatus) {
        var itemAll = '';
        $.each( result.data, function( key, value ) {
            itemAll  += '                         <tr>' +
                '                                    <td>'+value.shop_name+'</td>' +
                '                                    <td>'+value.profit_usd+'</td>' +
                '                                    <td>'+value.payment_status+'</td>' +
                '                                </tr>';
        });

        var table = '                      <table class="table table-striped">' +
            '                                <tbody>' + itemAll+
            '                                </tbody>' +
            '                            </table>';

        var cleanHTML = DOMPurify.sanitize(table, { USE_PROFILES: { html: true }});
         $('.orders-list').append(cleanHTML);
    },
    error: function () {
        $('.main-window').hide();
        $('.error-block').show();
    }
});

function copyReferralLink() {
    $( ".copyRefLink" ).click(function(e) {
        e.preventDefault();
        var clipboardReferral = new Clipboard('[data-clipboard-target]');
        var copyText = $(".s-copy-text").text();
        alert(copyText);
    });
}

function shareIcons(userID) {
    var copyText = $(".share-text").text();
    $("#shareRoundIcons").jsSocials({
        url: mainAPI.getReferralUrl(userID),
        text: copyText,
        showLabel: false,
        showCount: false,
        shareIn: 'popup',
        shares: ["facebook","vkontakte","googleplus", "twitter","viber", "telegram"]
    });
}
