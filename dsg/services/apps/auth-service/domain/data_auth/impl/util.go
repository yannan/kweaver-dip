package impl

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/kweaver-ai/kweaver-dip/dsg/services/apps/auth-service/common/constant"
)

const (
	RedisSavePrefix     = "auth-service:data_auth:"
	RedisSaveExpiration = time.Hour * 24 * 30 // 30天
)

const (
	AUDIT_ICON_BASE64 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34" +
		"AAAA70lEQVR4nO2UIQ7CMBSG/xkEYAkGFIZhhwYLChQJCzi4APeAC4CAsCAw4IaEU8BFQGDGXzHTNKxrWrcv" +
		"WfMqmm/vvb5602NyATDmZx3Pw14IEsbOKASZKAXbCVApMcjB+wsszwwklILTjAsRB+YB0Gtxo0EYcZH4K4ifQL" +
		"cJ1KrcaKAtGLaBcs4SfVii+MVAQimwiVKw6ptlsHkwkFAK0h6IA6Jcfp0bDbR7kArWdwp8oGNbIEpkMgciYxmlw" +
		"CZKwYB1N8ngpntN0x6IA0HDwaClAmdPxY6PnckcLPhDMkqBTQpBJl4YJVcqRoxdcPgB18l6zJGtm7IAAAAASUVORK5CYII="
)

func genAuditApplyID(dataID string) string {
	return fmt.Sprintf("%s-%s", dataID, time.Now().Format(constant.CommonTimeFormat))
}

func parseAuditApplyID(auditApplyID string) (dataID string, err error) {
	parts := strings.Split(auditApplyID, "-")
	if len(parts) != 2 {
		return "", errors.New("invalid audit apply id")
	}
	return parts[0], nil
}

// CE Conditional expression 条件表达式
func CE(condition bool, res1 any, res2 any) any {
	if condition {
		return res1
	}
	return res2
}

func genDataAuthRedisKey(dataID string) string {
	return fmt.Sprintf("%s:%s", RedisSavePrefix, dataID)
}
