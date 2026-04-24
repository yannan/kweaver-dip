package dto

import (
	"fmt"
	"time"

	"github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/common/constant"
)

const (
	AF_DATA_AUTH_REQUEST = "af-auth-service-data-auth-request" // auth_service发起的数据权限申请审核
)

// DataResourceAuthReq 数据资源授权申请请求
type DataResourceAuthReqArg struct {
	ResouceID []string `json:"resouce_id" binding:"required,min=1,max=100,dive,uuid"` //申请资源ID列表
	DataResourceAuthRequest
}

type DataResourceAuthRequest struct {
	ApplyType      string   `json:"apply_type" binding:"required,oneof=check query"` //申请类型
	Applicant      string   `json:"applicant" binding:"required,uuid"`               //申请人
	ApplicantName  string   `json:"applicant_name" binding:"required"`               //申请人名称
	ApplicantType  string   `json:"applicant_type" binding:"required"`               //申请人类型
	AuthOperations []string `json:"auth_operations" binding:"omitempty"`             //授权操作列表
	ExpiredAt      int64    `json:"expired_at" binding:"required,unix"`              //权限过期时间时间戳
}

// DataResourceAuthInfo 单个数据资源信息
type DataResourceAuthInfo struct {
	ID             string `json:"id" binding:"required,uuid"` //申请资源ID
	BusinessName   string `json:"business_name"`              //业务名称
	TechnicalName  string `json:"technical_name"`             //技术名称
	DatasourceID   string `json:"datasource_id"`              //数据源ID
	DatasourceName string `json:"datasource_name"`            //数据源名称
}

// DataResourceAuditInfo 数据资源审核信息
type DataResourceAuditInfo struct {
	ApplyID    string `json:"apply_id"`     //申请ID
	AuditType  string `json:"audit_type"`   //审核类型
	ProcDefKey string `json:"proc_def_key"` //审核流程key
	AuditState string `json:"audit_state"`  //审核状态
	AuditMsg   string `json:"audit_msg"`    //审核意见
	AuditTime  string `json:"audit_time"`   //审核时间
}

// DataResourceAuthAuditDetail   数据详情集合
type DataResourceAuthAuditDetail struct {
	Resources []*DataResourceAuthInfo `json:"resources"`  //资源信息
	Request   DataResourceAuthRequest `json:"request"`    //申请信息
	AuditInfo DataResourceAuditInfo   `json:"audit_info"` //审核信息
}

// DataViewAuthAuditDetail   数据视图详情
type DataViewAuthAuditDetail struct {
	Resources DataResourceAuthInfo    `json:"resources"`  //资源信息
	Request   DataResourceAuthRequest `json:"request"`    //申请信息
	AuditInfo DataResourceAuditInfo   `json:"audit_info"` //审核信息
}

// DataResourceAuthStatusReqArg 查询申请状态请求
type DataResourceAuthStatusReqArg struct {
	ResourceID string `form:"resource_id" binding:"required,uuid"` //数据资源（视图）ID
}

func (d *DataViewAuthAuditDetail) GetAuditAbstractName() string {
	args := []string{
		applicantType(d.Request.ApplicantType),
		d.Request.ApplicantName,
		d.Resources.DatasourceName,
		d.Resources.BusinessName,
		time.Unix(d.Request.ExpiredAt, 0).Format(constant.CommonTimeFormat),
	}
	return fmt.Sprintf("%s:%s申请‘%s’数据源的‘%s’视图，有效期：%s", args[0], args[1], args[2], args[3], args[4])
}

func applicantType(applicantType string) string {
	switch applicantType {
	case "user":
		return "用户"
	case "department":
		return "部门"
	case "role":
		return "角色"
	case "app":
		return "应用"
	}
	return ""
}
